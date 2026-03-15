"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NotificationsHeaderProps {
  total: number;
  onRefresh: () => void;
}

export function NotificationsHeader({ total, onRefresh }: NotificationsHeaderProps) {
  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Dashboard
          </Link>
        </Button>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Powiadomienia</h1>
          <span className="text-muted-foreground text-sm">({total} laczne)</span>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Odswiez
        </Button>
      </div>
    </>
  );
}
