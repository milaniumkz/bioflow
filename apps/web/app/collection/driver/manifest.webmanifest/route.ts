export function GET() {
  return Response.json(
    {
      id: "/collection/driver",
      name: "Collection Driver",
      short_name: "Driver",
      start_url: "/collection/driver",
      scope: "/collection/driver",
      display: "standalone",
      lang: "ru",
      background_color: "#ffffff",
      theme_color: "#17684f",
      icons: [192, 512].map((size) => ({
        src: `/collection-icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
      })),
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
