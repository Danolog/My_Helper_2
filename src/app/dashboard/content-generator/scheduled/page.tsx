"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  Instagram,
  Facebook,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trash2,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { toast } from "sonner";

type ScheduledPost = {
  id: string;
  salonId: string;
  platform: string;
  postType: string;
  content: string;
  hashtags: string[];
  tone: string | null;
  status: string;
  scheduledAt: string;
  publishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const PLATFORM_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  instagram: {
    label: "Instagram",
    icon: <Instagram className="h-4 w-4" />,
    color: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  },
  facebook: {
    label: "Facebook",
    icon: <Facebook className="h-4 w-4" />,
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  tiktok: {
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
    color:
      "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
  },
};

const POST_TYPE_LABELS: Record<string, string> = {
  promotion: "Promocja",
  service_highlight: "Prezentacja uslugi",
  tips_and_tricks: "Porady",
  behind_the_scenes: "Za kulisami",
  client_transformation: "Metamorfoza",
  seasonal: "Sezonowy",
  engagement: "Angazujacy",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  scheduled: {
    label: "Zaplanowany",
    icon: <Clock className="h-3.5 w-3.5" />,
    variant: "secondary",
  },
  published: {
    label: "Opublikowany",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    variant: "default",
  },
  cancelled: {
    label: "Anulowany",
    icon: <XCircle className="h-3.5 w-3.5" />,
    variant: "destructive",
  },
  failed: {
    label: "Blad",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    variant: "destructive",
  },
};

function ScheduledPostsContent() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPosts = async () => {
    try {
      const response = await fetch("/api/scheduled-posts");
      const data = await response.json();
      if (response.ok) {
        setPosts(data.posts || []);
      } else {
        toast.error(data.error || "Nie udalo sie pobrac postow");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  const handleCancel = async (postId: string) => {
    setActionLoading(postId);
    try {
      const response = await fetch(`/api/scheduled-posts/${postId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (response.ok) {
        toast.success("Post zostal anulowany");
        fetchPosts();
      } else {
        toast.error(data.error || "Nie udalo sie anulowac posta");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePublish = async (postId: string) => {
    setActionLoading(postId);
    try {
      const response = await fetch(`/api/scheduled-posts/${postId}/publish`, {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok) {
        toast.success("Post zostal opublikowany!");
        fetchPosts();
      } else {
        toast.error(data.error || "Nie udalo sie opublikowac posta");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setActionLoading(null);
    }
  };

  const scheduledPosts = posts.filter((p) => p.status === "scheduled");
  const publishedPosts = posts.filter((p) => p.status === "published");
  const cancelledPosts = posts.filter(
    (p) => p.status === "cancelled" || p.status === "failed"
  );

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator/social-posts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            Zaplanowane posty
          </h1>
          <p className="text-muted-foreground">
            Zarzadzaj zaplanowanymi publikacjami na social media
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/content-generator/social-posts">
            Nowy post
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{scheduledPosts.length}</p>
                <p className="text-xs text-muted-foreground">Zaplanowane</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{publishedPosts.length}</p>
                <p className="text-xs text-muted-foreground">Opublikowane</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{cancelledPosts.length}</p>
                <p className="text-xs text-muted-foreground">Anulowane</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Posts list */}
      {posts.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <CalendarClock className="h-12 w-12 opacity-20" />
              <p className="text-sm text-center">
                Nie masz jeszcze zaplanowanych postow.
                <br />
                Wygeneruj post i zaplanuj jego publikacje.
              </p>
              <Button variant="outline" asChild className="mt-2">
                <Link href="/dashboard/content-generator/social-posts">
                  Utworz nowy post
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Scheduled section */}
          {scheduledPosts.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-500" />
                Oczekujace na publikacje ({scheduledPosts.length})
              </h2>
              <div className="space-y-3">
                {scheduledPosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onCancel={handleCancel}
                    onPublish={handlePublish}
                    isLoading={actionLoading === post.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Published section */}
          {publishedPosts.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 mt-6">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Opublikowane ({publishedPosts.length})
              </h2>
              <div className="space-y-3">
                {publishedPosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onCancel={handleCancel}
                    onPublish={handlePublish}
                    isLoading={actionLoading === post.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Cancelled section */}
          {cancelledPosts.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 mt-6">
                <XCircle className="h-5 w-5 text-red-500" />
                Anulowane ({cancelledPosts.length})
              </h2>
              <div className="space-y-3">
                {cancelledPosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onCancel={handleCancel}
                    onPublish={handlePublish}
                    isLoading={actionLoading === post.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  onCancel,
  onPublish,
  isLoading,
}: {
  post: ScheduledPost;
  onCancel: (id: string) => void;
  onPublish: (id: string) => void;
  isLoading: boolean;
}) {
  const platformCfg = PLATFORM_CONFIG[post.platform];
  const statusCfg = STATUS_CONFIG[post.status];
  const postTypeLabel = POST_TYPE_LABELS[post.postType] ?? post.postType;

  const scheduledDate = new Date(post.scheduledAt);
  const now = new Date();
  const isPast = scheduledDate < now;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Platform icon */}
          <div
            className={`p-2 rounded-lg flex-shrink-0 ${platformCfg?.color ?? "bg-gray-100 text-gray-700"}`}
          >
            {platformCfg?.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm">{platformCfg?.label ?? post.platform}</span>
              <Badge variant="outline" className="text-xs">
                {postTypeLabel}
              </Badge>
              <Badge
                variant={statusCfg?.variant ?? "secondary"}
                className="flex items-center gap-1 text-xs"
              >
                {statusCfg?.icon}
                {statusCfg?.label ?? post.status}
              </Badge>
            </div>

            {/* Post preview */}
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
              {post.content}
            </p>

            {/* Schedule info */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {post.status === "published" && post.publishedAt ? (
                <span>
                  Opublikowano:{" "}
                  {new Date(post.publishedAt).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : post.status === "cancelled" && post.cancelledAt ? (
                <span>
                  Anulowano:{" "}
                  {new Date(post.cancelledAt).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : (
                <span>
                  Zaplanowano na:{" "}
                  {scheduledDate.toLocaleDateString("pl-PL", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {isPast && post.status === "scheduled" && (
                    <Badge variant="destructive" className="ml-2 text-xs">
                      Przeterminowany
                    </Badge>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          {post.status === "scheduled" && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPublish(post.id)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5 mr-1" />
                    Publikuj teraz
                  </>
                )}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={isLoading}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Anulowac zaplanowany post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Post na {platformCfg?.label ?? post.platform} zaplanowany na{" "}
                      {scheduledDate.toLocaleDateString("pl-PL", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      zostanie anulowany. Tej akcji nie mozna cofnac.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Nie, zachowaj</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => onCancel(post.id)}
                    >
                      Tak, anuluj post
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScheduledPostsPage() {
  return (
    <ProPlanGate
      featureName="Zaplanowane posty"
      featureDescription="Planuj publikacje postow na social media z wyprzedzeniem."
      proBenefits={[
        "Planowanie postow na przyszlosc",
        "Zarzadzanie kolejka publikacji",
        "Automatyczne publikowanie w wybranym terminie",
        "Podglad zaplanowanych tresci",
        "Mozliwosc anulowania lub recznej publikacji",
      ]}
    >
      <ScheduledPostsContent />
    </ProPlanGate>
  );
}
