"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, Image as ImageIcon, Folder, FolderPlus } from "lucide-react";
import {
  GalleryToolbar,
  GalleryGrid,
  PhotoUploadDialog,
  PhotoEditDialog,
  PhotoLinkDialog,
  PhotoLightbox,
  AlbumManager,
  CaptionDialog,
  PhotoEnhanceDialog,
} from "@/components/gallery";
import type { GalleryPhoto, Employee, Service, Album } from "@/components/gallery";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { mutationFetch } from "@/lib/api-client";

export default function GalleryPage() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  // Core data
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [activeTab, setActiveTab] = useState<"photos" | "albums">("photos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<GalleryPhoto | null>(null);
  const [linkingPhoto, setLinkingPhoto] = useState<GalleryPhoto | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filter state
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>("");
  const [filterServiceId, setFilterServiceId] = useState<string>("");
  const [filterPairsOnly, setFilterPairsOnly] = useState(false);

  // Album state shared between parent and AlbumManager
  const [albumsList, setAlbumsList] = useState<Album[]>([]);
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false);
  const [addToAlbumPhotoId, setAddToAlbumPhotoId] = useState<string | null>(null);
  const [addToAlbumDialogOpen, setAddToAlbumDialogOpen] = useState(false);

  // Caption dialog state
  const [captionPhoto, setCaptionPhoto] = useState<GalleryPhoto | null>(null);
  const [captionDialogOpen, setCaptionDialogOpen] = useState(false);

  // Enhance dialog state
  const [enhancePhoto, setEnhancePhoto] = useState<GalleryPhoto | null>(null);
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);

  // ---- Data fetching ----

  const fetchPhotos = useCallback(async (employeeFilter?: string, serviceFilter?: string, signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      let url = `/api/gallery?salonId=${salonId}`;
      if (employeeFilter) url += `&employeeId=${employeeFilter}`;
      if (serviceFilter) url += `&serviceId=${serviceFilter}`;
      const res = await fetch(url, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setPhotos(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  const fetchEmployees = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/employees?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  const fetchServices = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/services?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  useEffect(() => {
    const abortController = new AbortController();
    fetchPhotos(undefined, undefined, abortController.signal);
    fetchEmployees(abortController.signal);
    fetchServices(abortController.signal);
    return () => abortController.abort();
  }, [fetchPhotos, fetchEmployees, fetchServices]);

  // ---- Filter helpers ----

  const getActiveEmployeeFilter = (empFilter?: string) => {
    const eid = empFilter !== undefined ? empFilter : filterEmployeeId;
    return eid && eid !== "all" ? eid : undefined;
  };

  const getActiveServiceFilter = (svcFilter?: string) => {
    const sid = svcFilter !== undefined ? svcFilter : filterServiceId;
    return sid && sid !== "all" ? sid : undefined;
  };

  const displayPhotos = filterPairsOnly
    ? photos.filter((p) => p.beforePhotoUrl && p.afterPhotoUrl)
    : photos;

  const handleFilterChange = (value: string) => {
    setFilterEmployeeId(value);
    setLoading(true);
    fetchPhotos(value !== "all" ? value : undefined, getActiveServiceFilter());
  };

  const handleServiceFilterChange = (value: string) => {
    setFilterServiceId(value);
    setLoading(true);
    fetchPhotos(getActiveEmployeeFilter(), value !== "all" ? value : undefined);
  };

  const handleClearFilters = () => {
    setFilterEmployeeId("");
    setFilterServiceId("");
    setFilterPairsOnly(false);
    setLoading(true);
    fetchPhotos();
  };

  // ---- Photo actions ----

  const handleDelete = async (id: string) => {
    try {
      const res = await mutationFetch(`/api/gallery/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
        setDeleteConfirm(null);
        setSelectedPhoto(null);
      }
    } catch {
      // silently ignore
    }
  };

  const openEditDialog = (photo: GalleryPhoto) => {
    setEditingPhoto(photo);
    setSelectedPhoto(null);
  };

  const openLinkDialog = (photo: GalleryPhoto) => {
    setLinkingPhoto(photo);
    setSelectedPhoto(null);
  };

  const openCaptionDialog = (photo: GalleryPhoto) => {
    setCaptionPhoto(photo);
    setCaptionDialogOpen(true);
    setSelectedPhoto(null);
  };

  const openEnhanceDialog = (photo: GalleryPhoto) => {
    setEnhancePhoto(photo);
    setEnhanceDialogOpen(true);
    setSelectedPhoto(null);
  };

  const handlePhotoEnhanced = (enhancedUrl: string) => {
    // When a photo is enhanced, update the photo in state with the new URL.
    // The enhanced version replaces the "after" photo URL (or "before" if only before exists).
    if (enhancePhoto) {
      const updated: GalleryPhoto = {
        ...enhancePhoto,
        afterPhotoUrl: enhancedUrl,
      };
      setPhotos((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
    }
    setEnhancePhoto(null);
  };

  const handlePhotoSaved = (updatedPhoto: GalleryPhoto) => {
    setPhotos((prev) => prev.map((p) => (p.id === updatedPhoto.id ? updatedPhoto : p)));
    setEditingPhoto(null);
  };

  const handlePhotoLinked = (updatedPhoto: GalleryPhoto) => {
    setPhotos((prev) => prev.map((p) => (p.id === updatedPhoto.id ? updatedPhoto : p)));
    setLinkingPhoto(null);
  };

  const handleUploadComplete = () => {
    fetchPhotos(getActiveEmployeeFilter(), getActiveServiceFilter());
  };

  const handleAddToAlbumFromGrid = (photoId: string) => {
    setAddToAlbumPhotoId(photoId);
    setAddToAlbumDialogOpen(true);
  };

  const handleAddToAlbumFromLightbox = (photoId: string) => {
    setAddToAlbumPhotoId(photoId);
    setAddToAlbumDialogOpen(true);
    setSelectedPhoto(null);
  };

  // ---- Loading / auth guards ----

  if (isPending || salonLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
        <p className="text-muted-foreground mb-4">
          Zaloguj sie, aby uzyskac dostep do galerii
        </p>
        <Button asChild>
          <Link href="/dashboard">Powrot do panelu</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Powrot
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Galeria</h1>
            <p className="text-muted-foreground text-sm">
              Portfolio zdjec - przed i po zabiegach
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "albums" && (
            <Button variant="outline" onClick={() => setCreateAlbumOpen(true)}>
              <FolderPlus className="w-4 h-4 mr-2" />
              Nowy album
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Dodaj zdjecie
          </Button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "photos"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("photos")}
        >
          <ImageIcon className="w-4 h-4 inline-block mr-2" />
          Zdjecia
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "albums"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("albums")}
        >
          <Folder className="w-4 h-4 inline-block mr-2" />
          Albumy ({albumsList.length})
        </button>
      </div>

      {/* Album manager -- always rendered for dialogs, content only visible on albums tab */}
      {salonId && (
        <AlbumManager
          salonId={salonId}
          albums={albumsList}
          onAlbumsChange={setAlbumsList}
          onSelectPhoto={setSelectedPhoto}
          showContent={activeTab === "albums"}
          createAlbumOpen={createAlbumOpen}
          onCreateAlbumOpenChange={setCreateAlbumOpen}
          addToAlbumPhotoId={addToAlbumPhotoId}
          addToAlbumDialogOpen={addToAlbumDialogOpen}
          onAddToAlbumDialogOpenChange={setAddToAlbumDialogOpen}
          onAddToAlbumPhotoIdChange={setAddToAlbumPhotoId}
        />
      )}

      {/* Photos tab */}
      {activeTab === "photos" && (
        <>
          <GalleryToolbar
            employees={employees}
            services={services}
            filterEmployeeId={filterEmployeeId}
            filterServiceId={filterServiceId}
            filterPairsOnly={filterPairsOnly}
            displayPhotosCount={displayPhotos.length}
            onEmployeeFilterChange={handleFilterChange}
            onServiceFilterChange={handleServiceFilterChange}
            onTogglePairsOnly={() => setFilterPairsOnly(!filterPairsOnly)}
            onClearFilters={handleClearFilters}
          />

          <GalleryGrid
            photos={displayPhotos}
            loading={loading}
            filterPairsOnly={filterPairsOnly}
            onSelectPhoto={setSelectedPhoto}
            onEditPhoto={openEditDialog}
            onDeletePhoto={(id) => setDeleteConfirm(id)}
            onLinkPhoto={openLinkDialog}
            onAddToAlbum={handleAddToAlbumFromGrid}
            onOpenUploadDialog={() => setDialogOpen(true)}
          />

          {/* Photo detail lightbox */}
          <PhotoLightbox
            photo={selectedPhoto}
            onClose={() => setSelectedPhoto(null)}
            onEdit={openEditDialog}
            onDelete={(id) => setDeleteConfirm(id)}
            onLink={openLinkDialog}
            onAddToAlbum={handleAddToAlbumFromLightbox}
            onGenerateCaption={openCaptionDialog}
            onEnhancePhoto={openEnhanceDialog}
          />

          {/* Link matching photo dialog */}
          <PhotoLinkDialog
            photo={linkingPhoto}
            onClose={() => setLinkingPhoto(null)}
            onLinked={handlePhotoLinked}
          />

          {/* Edit photo dialog */}
          <PhotoEditDialog
            photo={editingPhoto}
            employees={employees}
            services={services}
            onClose={() => setEditingPhoto(null)}
            onSave={handlePhotoSaved}
          />

          {/* Delete confirmation dialog */}
          {deleteConfirm && (
            <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Potwierdz usuniecie</DialogTitle>
                </DialogHeader>
                <p className="text-muted-foreground">
                  Czy na pewno chcesz usunac to zdjecie? Tej operacji nie mozna cofnac.
                </p>
                <div className="flex gap-2 justify-end mt-4">
                  <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                    Anuluj
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleDelete(deleteConfirm)}
                  >
                    Usun
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}

      {/* Upload dialog (shared across tabs) */}
      {salonId && (
        <PhotoUploadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          employees={employees}
          services={services}
          salonId={salonId}
          onUploadComplete={handleUploadComplete}
        />
      )}

      {/* Caption dialog (shared across tabs) */}
      <CaptionDialog
        photo={captionPhoto}
        open={captionDialogOpen}
        onOpenChange={(open) => {
          setCaptionDialogOpen(open);
          if (!open) setCaptionPhoto(null);
        }}
      />

      {/* Enhance dialog (shared across tabs) */}
      <PhotoEnhanceDialog
        photo={enhancePhoto}
        open={enhanceDialogOpen}
        onOpenChange={(open) => {
          setEnhanceDialogOpen(open);
          if (!open) setEnhancePhoto(null);
        }}
        onEnhanced={handlePhotoEnhanced}
      />

    </div>
  );
}
