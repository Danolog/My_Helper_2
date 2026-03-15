"use client";

import { Instagram, Facebook } from "lucide-react";
import type { PlatformOption } from "../_types";

/** Platform options with their icons. Kept in a separate file because it contains JSX. */
export const PLATFORMS: PlatformOption[] = [
  {
    value: "instagram",
    label: "Instagram",
    icon: <Instagram className="h-4 w-4" />,
  },
  {
    value: "facebook",
    label: "Facebook",
    icon: <Facebook className="h-4 w-4" />,
  },
  {
    value: "tiktok",
    label: "TikTok",
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.8a8.28 8.28 0 004.76 1.5V6.86a4.84 4.84 0 01-1-.17z" />
      </svg>
    ),
  },
];
