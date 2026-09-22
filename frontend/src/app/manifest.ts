import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Careflow',
    short_name: 'Careflow',
    description: 'A little care, all in one place.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f7f9f9',
    theme_color: '#0d776e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
