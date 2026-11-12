export function GET() {
  return Response.json(
    {
      id: "/collection",
      name: "Collection",
      short_name: "Collection",
      description: "Сбор, мойка, склады и заводы",
      lang: "ru",
      start_url: "/collection",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#13795b",
      icons: [192, 512].map((size) => ({
        src: `/collection-icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any",
      })),
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
