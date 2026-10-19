/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_BASE_PATH || "";
const nextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
