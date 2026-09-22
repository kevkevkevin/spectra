import type {NextConfig} from 'next';
const nextConfig:NextConfig={distDir:process.env.NODE_ENV==='development'?'.next-dev':'.next',turbopack:{root:process.cwd()},poweredByHeader:false,experimental:{serverActions:{bodySizeLimit:'4.25mb'}}};
export default nextConfig;
