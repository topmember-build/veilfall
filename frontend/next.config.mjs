/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the whole app is plain files, so it can be hosted anywhere
  // (Cloudflare Pages, Netlify, GitHub Pages...) and judges just open a URL.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
