import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyHelper",
    short_name: "MyHelper",
    description:
      "MyHelper - przystepna cenowo alternatywa dla Booksy z asystentem AI dla salonow uslugowych",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
