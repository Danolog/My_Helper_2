"use client";

import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ErrorStateProps {
  error: string | null;
}

export function ErrorState({ error }: ErrorStateProps) {
  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/appointments">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do moich wizyt
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">
            {error || "Wizyta nie znaleziona"}
          </h2>
          <Button asChild>
            <Link href="/appointments">Powrot do moich wizyt</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
