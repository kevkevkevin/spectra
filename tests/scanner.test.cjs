const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
// pngjs is qrcode's PNG encoder dependency. Decode the actual generated image
// rather than mocking the QR library or the scanner's pixel input.
const {PNG} = require('pngjs');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath, imports = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    fileName: relativePath,
  });
  const module = {exports: {}};
  const context = vm.createContext({
    module,
    exports: module.exports,
    URL,
    Intl,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
  });
  new vm.Script(outputText, {filename: relativePath}).runInContext(context);
  return module.exports;
}

const tickets = loadTypeScript('lib/tickets.ts');
const {ticketToken} = loadTypeScript('lib/scanner.ts', {'./tickets': tickets});
const token = 'd3b9b639-2c38-46e7-94f5-ae7d975742bc';

test('scanner accepts pasted raw UUIDs and normalizes surrounding whitespace and case', () => {
  assert.equal(ticketToken(token), token);
  assert.equal(ticketToken(` \n${token.toUpperCase()}\t `), token);
  assert.equal(ticketToken(token.slice(0, -1)), null);
  assert.equal(ticketToken(`${token}x`), null);
  assert.equal(ticketToken(token.replace('d3b9', 'g3b9')), null);
  assert.equal(ticketToken(''), null);
});

test('scanner accepts current and previously issued QR routes without opening the URL', () => {
  for (const route of ['staff/scan', 'admin/tickets/verify']) {
    for (const origin of ['https://spectra.example.com', 'http://localhost:3000']) {
      assert.equal(ticketToken(`${origin}/${route}/${token}`), token);
      assert.equal(ticketToken(`${origin}/${route}/${token.toUpperCase()}/`), token);
    }
  }
});

test('scanner rejects executable schemes, credentials, query strings, and fragments', () => {
  const invalid = [
    `javascript:alert('${token}')`,
    `data:text/html,<script>${token}</script>`,
    `file:///staff/scan/${token}`,
    `ftp://spectra.example.com/staff/scan/${token}`,
    `https://name:password@spectra.example.com/staff/scan/${token}`,
    `https://name@spectra.example.com/staff/scan/${token}`,
    `https://spectra.example.com/staff/scan/${token}?mode=food`,
    `https://spectra.example.com/staff/scan/${token}?redirect=https://other.example`,
    `https://spectra.example.com/staff/scan/${token}#food`,
    `<script src="https://spectra.example.com/staff/scan/${token}"></script>`,
  ];
  for (const input of invalid) assert.equal(ticketToken(input), null, input);
});

test('scanner rejects unsupported paths and malformed or oversized QR contents', () => {
  const invalid = [
    `/staff/scan/${token}`,
    `//spectra.example.com/staff/scan/${token}`,
    `https://spectra.example.com/account/orders/${token}`,
    `https://spectra.example.com/staff/scan`,
    `https://spectra.example.com/staff/scan/${token}/extra`,
    `https://spectra.example.com/prefix/staff/scan/${token}`,
    `https://spectra.example.com/staff/scan/${token}/food`,
    `https://spectra.example.com/staff/scan/%64${token.slice(1)}`,
    `https://spectra.example.com/staff/scan/${token}%2f`,
    `https://spectra.example.com/staff/scan/${token}\u0000`,
    `https://spectra.example.com/staff/scan/not-a-ticket`,
    `https://spectra.example.com/staff/scan/${token}${'a'.repeat(600)}`,
  ];
  for (const input of invalid) assert.equal(ticketToken(input), null, JSON.stringify(input));
});

for (const route of ['staff/scan', 'admin/tickets/verify']) {
  test(`an actual 260px ${route} QR image decodes to the original ticket token`, async () => {
    const value = `https://spectra.example.com/${route}/${token}`;
    const image = await QRCode.toBuffer(value, {
      width: 260,
      margin: 3,
      errorCorrectionLevel: 'M',
      color: {dark: '#171025', light: '#ffffff'},
    });
    const png = PNG.sync.read(image);
    assert.equal(png.width, 260);
    assert.equal(png.height, 260);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {inversionAttempts: 'dontInvert'});
    assert.ok(decoded, 'The camera decoder should read the QR produced for the ticket dashboard');
    assert.equal(decoded.data, value);
    assert.equal(ticketToken(decoded.data), token);
  });
}

test('a readable QR containing an unrelated URL is rejected by the ticket parser', async () => {
  const image = await QRCode.toBuffer('https://other.example/checkout?payment=1', {width: 260, margin: 3});
  const png = PNG.sync.read(image);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded);
  assert.equal(ticketToken(decoded.data), null);
});
