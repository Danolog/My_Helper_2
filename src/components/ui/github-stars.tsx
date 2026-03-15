"use client";

import { useState, useEffect } from "react";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GitHubStarsProps {
  repo: string;
}

export function GitHubStars({ repo }: GitHubStarsProps) {
  const [stars, setStars] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchStars() {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted) setStars(data.stargazers_count);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchStars();
    return () => controller.abort();
  }, [repo]);

  const formatStars = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={`https://github.com/${repo}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2"
      >
        <Github className="h-4 w-4" />
        {loading ? "..." : stars !== null ? formatStars(stars) : "0"}
      </a>
    </Button>
  );
}