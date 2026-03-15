"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { ArrowLeft, Trash2, Image as ImageIcon, Loader2, SlidersHorizontal, FolderPlus, FolderOpen, Folder, FolderMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mutationFetch } from "@/lib/api-client";
import type { GalleryPhoto, Album } from "./gallery-types";

// ---- Sub-components for album management dialogs ----

interface CreateAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (album: Album) => void;
  salonId: string;
}

function CreateAlbumDialog({ open, onOpenChange, onCreated, salonId }: CreateAlbumDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await mutationFetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId,
          name: name.trim(),
          category: category.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onCreated(data.data);
        setName("");
        setCategory("");
        onOpenChange(false);
      } else {
        toast.error("Nie udalo sie utworzyc albumu. Sprobuj ponownie.");
      }
    } catch {
      toast.error("Nie udalo sie utworzyc albumu. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nowy album</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label className="mb-2 block">Nazwa albumu</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Koloryzacje lato 2025"
              autoFocus
            />
          </div>
          <div>
            <Label className="mb-2 block">Kategoria (opcjonalnie)</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="np. Koloryzacja, Strzyzenie"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || creating}>
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Tworzenie...
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Utworz album
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AddToAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  albums: Album[];
  onAdd: (albumId: string) => void;
  onCreateAlbum: () => void;
  adding: boolean;
}

function AddToAlbumDialog({ open, onOpenChange, albums, onAdd, onCreateAlbum, adding }: AddToAlbumDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj do albumu</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          {albums.length === 0 ? (
            <div className="text-center py-6">
              <Folder className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-3">Brak albumow. Utworz pierwszy album.</p>
              <Button size="sm" onClick={onCreateAlbum}>
                <FolderPlus className="w-4 h-4 mr-2" />
                Nowy album
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Wybierz album, do ktorego chcesz dodac zdjecie:</p>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {albums.map((album) => (
                  <button
                    key={album.id}
                    onClick={() => onAdd(album.id)}
                    disabled={adding}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                  >
                    <FolderOpen className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{album.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {album.photoCount} {album.photoCount === 1 ? "zdjecie" : "zdjec"}
                        {album.category && ` · ${album.category}`}
                      </p>
                    </div>
                    {adding && (
                      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteAlbumDialogProps {
  album: Album | null;
  onClose: () => void;
  onConfirm: (album: Album) => void;
}

function DeleteAlbumDialog({ album, onClose, onConfirm }: DeleteAlbumDialogProps) {
  if (!album) return null;
  return (
    <Dialog open={!!album} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usun album</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">
          Czy na pewno chcesz usunac album <strong>&quot;{album.name}&quot;</strong>?
          Zdjecia nie zostana usuniete - tylko album.
        </p>
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(album)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Usun album
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main AlbumManager component ----

interface AlbumManagerProps {
  salonId: string;
  albums: Album[];
  onAlbumsChange: (albums: Album[]) => void;
  onSelectPhoto: (photo: GalleryPhoto) => void;
  /** When false, hides the album list/detail view but still renders dialogs */
  showContent: boolean;
  /** Controls whether the create album dialog is shown from the parent header button */
  createAlbumOpen: boolean;
  onCreateAlbumOpenChange: (open: boolean) => void;
  /** Controls the "add photo to album" dialog */
  addToAlbumPhotoId: string | null;
  addToAlbumDialogOpen: boolean;
  onAddToAlbumDialogOpenChange: (open: boolean) => void;
  onAddToAlbumPhotoIdChange: (id: string | null) => void;
}

export function AlbumManager({
  salonId,
  albums,
  onAlbumsChange,
  onSelectPhoto,
  showContent,
  createAlbumOpen,
  onCreateAlbumOpenChange,
  addToAlbumPhotoId,
  addToAlbumDialogOpen,
  onAddToAlbumDialogOpenChange,
  onAddToAlbumPhotoIdChange,
}: AlbumManagerProps) {
  const [viewingAlbum, setViewingAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<GalleryPhoto[]>([]);
  const [albumPhotosLoading, setAlbumPhotosLoading] = useState(false);
  const [deleteAlbumConfirm, setDeleteAlbumConfirm] = useState<Album | null>(null);
  const [removingFromAlbum, setRemovingFromAlbum] = useState<string | null>(null);
  const [addingToAlbum, setAddingToAlbum] = useState(false);
  const [albumsLoading, setAlbumsLoading] = useState(false);

  const fetchAlbums = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    setAlbumsLoading(true);
    try {
      const res = await fetch(`/api/albums?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        onAlbumsChange(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setAlbumsLoading(false);
    }
  }, [salonId, onAlbumsChange]);

  const fetchAlbumPhotos = useCallback(async (albumId: string) => {
    setAlbumPhotosLoading(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`);
      const data = await res.json();
      if (data.success) {
        setAlbumPhotos(data.data);
      }
    } catch {
      // silently ignore
    } finally {
      setAlbumPhotosLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    const controller = new AbortController();
    fetchAlbums(controller.signal);
    return () => controller.abort();
  }, [fetchAlbums]);

  const openViewAlbum = (album: Album) => {
    setViewingAlbum(album);
    fetchAlbumPhotos(album.id);
  };

  const handleDeleteAlbum = async (album: Album) => {
    try {
      const res = await mutationFetch(`/api/albums/${album.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        onAlbumsChange(albums.filter((a) => a.id !== album.id));
        setDeleteAlbumConfirm(null);
        if (viewingAlbum?.id === album.id) {
          setViewingAlbum(null);
          setAlbumPhotos([]);
        }
      }
    } catch {
      // silently ignore
    }
  };

  const handleAddToAlbum = async (albumId: string) => {
    if (!addToAlbumPhotoId) return;
    setAddingToAlbum(true);
    try {
      const res = await mutationFetch(`/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: [addToAlbumPhotoId] }),
      });
      const data = await res.json();
      if (data.success) {
        onAddToAlbumPhotoIdChange(null);
        onAddToAlbumDialogOpenChange(false);
        // Refresh albums to update photo counts
        fetchAlbums();
        // If viewing an album, refresh its photos
        if (viewingAlbum) {
          fetchAlbumPhotos(viewingAlbum.id);
        }
      } else {
        toast.error("Nie udalo sie dodac zdjecia do albumu. Sprobuj ponownie.");
      }
    } catch {
      // silently ignore
    } finally {
      setAddingToAlbum(false);
    }
  };

  const handleRemoveFromAlbum = async (photoId: string) => {
    if (!viewingAlbum) return;
    setRemovingFromAlbum(photoId);
    try {
      const res = await mutationFetch(
        `/api/albums/${viewingAlbum.id}/photos?photoId=${photoId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        setAlbumPhotos((prev) => prev.filter((p) => p.id !== photoId));
        // Update album photo count locally
        onAlbumsChange(
          albums.map((a) =>
            a.id === viewingAlbum.id
              ? { ...a, photoCount: Math.max(0, a.photoCount - 1) }
              : a
          )
        );
      }
    } catch {
      // silently ignore
    } finally {
      setRemovingFromAlbum(null);
    }
  };

  const handleAlbumCreated = (album: Album) => {
    onAlbumsChange([album, ...albums]);
  };

  return (
    <>
      {/* Album list view -- only rendered when showContent is true */}
      {showContent && !viewingAlbum && (
        <div>
          {albumsLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : albums.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Folder className="w-16 h-16 text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold mb-2">Brak albumow</h2>
              <p className="text-muted-foreground mb-4">
                Utworz pierwszy album, aby pogrupowac zdjecia
              </p>
              <Button onClick={() => onCreateAlbumOpenChange(true)}>
                <FolderPlus className="w-4 h-4 mr-2" />
                Nowy album
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {albums.map((album) => (
                <div
                  key={album.id}
                  className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                  onClick={() => openViewAlbum(album)}
                >
                  <div className="aspect-video bg-muted flex flex-col items-center justify-center gap-2">
                    <FolderOpen className="w-12 h-12 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {album.photoCount} {album.photoCount === 1 ? "zdjecie" : "zdjec"}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="font-medium truncate">{album.name}</p>
                    {album.category && (
                      <p className="text-xs text-muted-foreground">{album.category}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(album.createdAt).toLocaleDateString("pl-PL")}
                    </p>
                  </div>
                  {/* Delete button overlay */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteAlbumConfirm(album);
                    }}
                    className="absolute top-2 right-2 bg-red-500/80 text-white p-1.5 rounded hover:bg-red-600/90 transition-colors opacity-0 group-hover:opacity-100"
                    title="Usun album"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Album detail view -- only rendered when showContent is true */}
      {showContent && viewingAlbum && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setViewingAlbum(null); setAlbumPhotos([]); }}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Wszystkie albumy
            </Button>
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FolderOpen className="w-5 h-5" />
                {viewingAlbum.name}
              </h2>
              {viewingAlbum.category && (
                <p className="text-xs text-muted-foreground">{viewingAlbum.category}</p>
              )}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              {albumPhotos.length} {albumPhotos.length === 1 ? "zdjecie" : "zdjec"}
            </span>
          </div>

          {albumPhotosLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : albumPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <ImageIcon className="w-16 h-16 text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold mb-2">Album jest pusty</h2>
              <p className="text-muted-foreground mb-4">
                Dodaj zdjecia do tego albumu z zakladki Zdjecia
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {albumPhotos.map((photo) => {
                const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;

                return (
                  <div
                    key={photo.id}
                    className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                    onClick={() => onSelectPhoto(photo)}
                  >
                    <div className="aspect-square relative">
                      {isPair ? (
                        <div className="w-full h-full flex">
                          <div className="w-1/2 h-full relative overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.beforePhotoUrl!} alt="Przed" className="absolute inset-0 w-[200%] h-full object-cover" />
                          </div>
                          <div className="w-0.5 bg-white z-10 relative" />
                          <div className="w-1/2 h-full relative overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.afterPhotoUrl!} alt="Po" className="absolute inset-0 w-[200%] h-full object-cover object-right" />
                          </div>
                        </div>
                      ) : photo.afterPhotoUrl ? (
                        <Image src={photo.afterPhotoUrl} alt={photo.description || "Zdjecie"} fill className="object-cover" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" />
                      ) : photo.beforePhotoUrl ? (
                        <Image src={photo.beforePhotoUrl} alt={photo.description || "Zdjecie"} fill className="object-cover" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <ImageIcon className="w-12 h-12 text-muted-foreground" />
                        </div>
                      )}
                      {isPair && (
                        <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                          <SlidersHorizontal className="w-3 h-3" />
                          Przed / Po
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      {photo.employeeFirstName && (
                        <p className="text-sm font-medium">{photo.employeeFirstName} {photo.employeeLastName}</p>
                      )}
                      {photo.serviceName && (
                        <p className="text-xs text-muted-foreground">{photo.serviceName}</p>
                      )}
                      {photo.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{photo.description}</p>
                      )}
                    </div>
                    {/* Remove from album button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromAlbum(photo.id);
                      }}
                      className="absolute top-2 right-2 bg-orange-500/80 text-white p-1.5 rounded hover:bg-orange-600/90 transition-colors opacity-0 group-hover:opacity-100"
                      title="Usun z albumu"
                      disabled={removingFromAlbum === photo.id}
                    >
                      {removingFromAlbum === photo.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderMinus className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Album dialog */}
      <CreateAlbumDialog
        open={createAlbumOpen}
        onOpenChange={onCreateAlbumOpenChange}
        onCreated={handleAlbumCreated}
        salonId={salonId}
      />

      {/* Add to Album dialog */}
      <AddToAlbumDialog
        open={addToAlbumDialogOpen}
        onOpenChange={(open) => {
          onAddToAlbumDialogOpenChange(open);
          if (!open) onAddToAlbumPhotoIdChange(null);
        }}
        albums={albums}
        onAdd={handleAddToAlbum}
        onCreateAlbum={() => {
          onAddToAlbumDialogOpenChange(false);
          onCreateAlbumOpenChange(true);
        }}
        adding={addingToAlbum}
      />

      {/* Delete Album confirmation */}
      <DeleteAlbumDialog
        album={deleteAlbumConfirm}
        onClose={() => setDeleteAlbumConfirm(null)}
        onConfirm={handleDeleteAlbum}
      />
    </>
  );
}
