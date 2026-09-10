import type {NextConfig} from 'next';
const nextConfig:NextConfig={turbopack:{root:process.cwd()},poweredByHeader:false,experimental:{serverActions:{bodySizeLimit:'4.25mb'}}};
export default nextConfig;
