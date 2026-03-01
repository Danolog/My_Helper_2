"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Trash2, Image as ImageIcon, Plus, X, Loader2, Pencil, Check, Filter, Users, Scissors, SlidersHorizontal, Link2, Eye, EyeOff, FolderPlus, FolderOpen, Folder, FolderMinus, Sparkles, Copy, Instagram, Facebook, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { useSalonId } from "@/hooks/use-salon-id";

type CaptionPlatform = "instagram" | "facebook" | "tiktok";

interface GalleryPhoto {
  id: string;
  salonId: string;
  employeeId: string | null;
  serviceId: string | null;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  description: string | null;
  productsUsed: string | null;
  techniques: string | null;
  duration: number | null;
  showProductsToClients: boolean;
  createdAt: string;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

interface Service {
  id: string;
  name: string;
}

interface Album {
  id: string;
  salonId: string;
  name: string;
  category: string | null;
  createdAt: string;
  photoCount: number;
}

// Comparison slider component for before/after photos
function ComparisonSlider({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) {
        handleMove(e.clientX);
      }
    },
    [handleMove]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleMove(touch.clientX);
    },
    [handleMove]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[4/3] overflow-hidden rounded-lg cursor-col-resize select-none"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
      onClick={(e) => handleMove(e.clientX)}
      data-testid="comparison-slider"
    >
      {/* After photo (full width background) */}
      <img
        src={afterUrl}
        alt="Po zabiegu"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />

      {/* Before photo (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${sliderPosition}%` }}
      >
        <img
          src={beforeUrl}
          alt="Przed zabiegiem"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ width: containerRef.current ? `${containerRef.current.offsetWidth}px` : '100%' }}
          draggable={false}
        />
      </div>

      {/* Slider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Slider handle */}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-gray-200">
          <SlidersHorizontal className="w-5 h-5 text-gray-600" />
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-3 left-3 bg-black/60 text-white text-xs font-semibold px-2 py-1 rounded z-20">
        PRZED
      </div>
      <div className="absolute top-3 right-3 bg-black/60 text-white text-xs font-semibold px-2 py-1 rounded z-20">
        PO
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<GalleryPhoto | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editTechniques, setEditTechniques] = useState("");
  const [editProductsUsed, setEditProductsUsed] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editServiceId, setEditServiceId] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editShowProductsToClients, setEditShowProductsToClients] = useState(true);
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>("");
  const [filterServiceId, setFilterServiceId] = useState<string>("");
  const [filterPairsOnly, setFilterPairsOnly] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<"slider" | "side-by-side">("slider");

  // Album state
  const [activeTab, setActiveTab] = useState<"photos" | "albums">("photos");
  const [albumsList, setAlbumsList] = useState<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [createAlbumOpen, setCreateAlbumOpen] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [newAlbumCategory, setNewAlbumCategory] = useState("");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [viewingAlbum, setViewingAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<GalleryPhoto[]>([]);
  const [albumPhotosLoading, setAlbumPhotosLoading] = useState(false);
  const [addToAlbumPhotoId, setAddToAlbumPhotoId] = useState<string | null>(null);
  const [addToAlbumDialogOpen, setAddToAlbumDialogOpen] = useState(false);
  const [addingToAlbum, setAddingToAlbum] = useState(false);
  const [deleteAlbumConfirm, setDeleteAlbumConfirm] = useState<Album | null>(null);
  const [removingFromAlbum, setRemovingFromAlbum] = useState<string | null>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [beforePreview, setBeforePreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [techniques, setTechniques] = useState("");
  const [productsUsed, setProductsUsed] = useState("");
  const [uploadDuration, setUploadDuration] = useState("");
  const afterInputRef = useRef<HTMLInputElement>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);

  // Link photo dialog state - for adding matching before/after to existing photo
  const [linkingPhoto, setLinkingPhoto] = useState<GalleryPhoto | null>(null);
  const [linkFile, setLinkFile] = useState<File | null>(null);
  const [linkPreview, setLinkPreview] = useState<string | null>(null);
  const [linkUploading, setLinkUploading] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Generate post caption state
  const [captionDialogOpen, setCaptionDialogOpen] = useState(false);
  const [captionPhoto, setCaptionPhoto] = useState<GalleryPhoto | null>(null);
  const [captionPlatform, setCaptionPlatform] = useState<CaptionPlatform>("instagram");
  const [captionLoading, setCaptionLoading] = useState(false);
  const [generatedCaption, setGeneratedCaption] = useState<string | null>(null);
  const [captionHashtags, setCaptionHashtags] = useState<string[]>([]);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [isCaptionEditing, setIsCaptionEditing] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");

  const openCaptionDialog = (photo: GalleryPhoto) => {
    setCaptionPhoto(photo);
    setCaptionDialogOpen(true);
    setGeneratedCaption(null);
    setCaptionHashtags([]);
    setCaptionCopied(false);
    setCaptionPlatform("instagram");
    setIsCaptionEditing(false);
    setEditedCaption("");
  };

  const handleGenerateCaption = async () => {
    if (!captionPhoto) return;
    setCaptionLoading(true);
    setGeneratedCaption(null);
    setCaptionHashtags([]);
    setCaptionCopied(false);

    try {
      const res = await fetch("/api/ai/content/photo-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoId: captionPhoto.id,
          platform: captionPlatform,
          includeEmoji: true,
          includeHashtags: true,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setGeneratedCaption(data.caption);
        setEditedCaption(data.caption);
        setIsCaptionEditing(false);
        setCaptionHashtags(data.hashtags || []);
      } else {
        toast.error(data.error || "Blad podczas generowania podpisu");
      }
    } catch (error) {
      console.error("Caption generation error:", error);
      toast.error("Blad podczas generowania podpisu");
    } finally {
      setCaptionLoading(false);
    }
  };

  const handleCopyCaption = async () => {
    if (!generatedCaption) return;
    const textToCopy = editedCaption || generatedCaption;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCaptionCopied(true);
      toast.success("Skopiowano do schowka!");
      setTimeout(() => setCaptionCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };

  const handleToggleCaptionEdit = () => {
    if (!isCaptionEditing && generatedCaption) {
      setEditedCaption(editedCaption || generatedCaption);
    }
    setIsCaptionEditing(!isCaptionEditing);
  };

  const handleSaveCaptionEdit = () => {
    if (generatedCaption) {
      setGeneratedCaption(editedCaption);
      setIsCaptionEditing(false);
      toast.success("Zmiany zapisane!");
    }
  };

  const fetchPhotos = useCallback(async (employeeFilter?: string, serviceFilter?: string) => {
    if (!salonId) return;
    try {
      let url = `/api/gallery?salonId=${salonId}`;
      if (employeeFilter) {
        url += `&employeeId=${employeeFilter}`;
      }
      if (serviceFilter) {
        url += `&serviceId=${serviceFilter}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setPhotos(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch photos:", error);
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  const fetchEmployees = useCallback(async () => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/employees?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
    }
  }, [salonId]);

  const fetchServices = useCallback(async () => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/services?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch services:", error);
    }
  }, [salonId]);

  const fetchAlbums = useCallback(async () => {
    if (!salonId) return;
    setAlbumsLoading(true);
    try {
      const res = await fetch(`/api/albums?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setAlbumsList(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch albums:", error);
    } finally {
      setAlbumsLoading(false);
    }
  }, [salonId]);

  const fetchAlbumPhotos = useCallback(async (albumId: string) => {
    setAlbumPhotosLoading(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`);
      const data = await res.json();
      if (data.success) {
        setAlbumPhotos(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch album photos:", error);
    } finally {
      setAlbumPhotosLoading(false);
    }
  }, []);

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    setCreatingAlbum(true);
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: salonId!,
          name: newAlbumName.trim(),
          category: newAlbumCategory.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAlbumsList((prev) => [data.data, ...prev]);
        setNewAlbumName("");
        setNewAlbumCategory("");
        setCreateAlbumOpen(false);
      } else {
        toast.error("Nie udalo sie utworzyc albumu. Sprobuj ponownie.");
      }
    } catch (error) {
      console.error("Create album error:", error);
      toast.error("Nie udalo sie utworzyc albumu. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setCreatingAlbum(false);
    }
  };

  const handleDeleteAlbum = async (album: Album) => {
    try {
      const res = await fetch(`/api/albums/${album.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setAlbumsList((prev) => prev.filter((a) => a.id !== album.id));
        setDeleteAlbumConfirm(null);
        if (viewingAlbum?.id === album.id) {
          setViewingAlbum(null);
          setAlbumPhotos([]);
        }
      }
    } catch (error) {
      console.error("Delete album error:", error);
    }
  };

  const handleAddToAlbum = async (albumId: string) => {
    if (!addToAlbumPhotoId) return;
    setAddingToAlbum(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: [addToAlbumPhotoId] }),
      });
      const data = await res.json();
      if (data.success) {
        setAddToAlbumPhotoId(null);
        setAddToAlbumDialogOpen(false);
        // Refresh albums to update photo counts
        fetchAlbums();
        // If viewing an album, refresh its photos
        if (viewingAlbum) {
          fetchAlbumPhotos(viewingAlbum.id);
        }
      } else {
        toast.error("Nie udalo sie dodac zdjecia do albumu. Sprobuj ponownie.");
      }
    } catch (error) {
      console.error("Add to album error:", error);
    } finally {
      setAddingToAlbum(false);
    }
  };

  const handleRemoveFromAlbum = async (photoId: string) => {
    if (!viewingAlbum) return;
    setRemovingFromAlbum(photoId);
    try {
      const res = await fetch(
        `/api/albums/${viewingAlbum.id}/photos?photoId=${photoId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        setAlbumPhotos((prev) => prev.filter((p) => p.id !== photoId));
        // Update album photo count locally
        setAlbumsList((prev) =>
          prev.map((a) =>
            a.id === viewingAlbum.id
              ? { ...a, photoCount: Math.max(0, a.photoCount - 1) }
              : a
          )
        );
      }
    } catch (error) {
      console.error("Remove from album error:", error);
    } finally {
      setRemovingFromAlbum(null);
    }
  };

  const openViewAlbum = (album: Album) => {
    setViewingAlbum(album);
    fetchAlbumPhotos(album.id);
  };

  useEffect(() => {
    fetchPhotos();
    fetchEmployees();
    fetchServices();
    fetchAlbums();
  }, [fetchPhotos, fetchEmployees, fetchServices, fetchAlbums]);

  // Helper to get active filter values
  const getActiveEmployeeFilter = (empFilter?: string) => {
    const eid = empFilter !== undefined ? empFilter : filterEmployeeId;
    return eid && eid !== "all" ? eid : undefined;
  };
  const getActiveServiceFilter = (svcFilter?: string) => {
    const sid = svcFilter !== undefined ? svcFilter : filterServiceId;
    return sid && sid !== "all" ? sid : undefined;
  };

  // Filtered photos - apply pairs filter client-side
  const displayPhotos = filterPairsOnly
    ? photos.filter((p) => p.beforePhotoUrl && p.afterPhotoUrl)
    : photos;

  // Refetch when employee filter changes
  const handleFilterChange = (value: string) => {
    setFilterEmployeeId(value);
    setLoading(true);
    fetchPhotos(
      value !== "all" ? value : undefined,
      getActiveServiceFilter()
    );
  };

  // Refetch when service filter changes
  const handleServiceFilterChange = (value: string) => {
    setFilterServiceId(value);
    setLoading(true);
    fetchPhotos(
      getActiveEmployeeFilter(),
      value !== "all" ? value : undefined
    );
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "after" | "before"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === "after") {
      setUploadFile(file);
      const reader = new FileReader();
      reader.onload = () => setUploadPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setBeforeFile(file);
      const reader = new FileReader();
      reader.onload = () => setBeforePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const uploadFileToServer = async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/gallery/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.success) {
      return data.data.url;
    }
    return null;
  };

  const handleUpload = async () => {
    if (!uploadFile && !beforeFile) return;
    setUploading(true);

    try {
      // Upload after photo (if provided)
      let afterUrl: string | null = null;
      if (uploadFile) {
        afterUrl = await uploadFileToServer(uploadFile);
        if (!afterUrl) {
          toast.error("Nie udalo sie przeslac zdjecia. Sprobuj ponownie.");
          return;
        }
      }

      // Upload before photo (if provided)
      let beforeUrl: string | null = null;
      if (beforeFile) {
        beforeUrl = await uploadFileToServer(beforeFile);
        if (!beforeUrl) {
          toast.error("Nie udalo sie przeslac zdjecia. Sprobuj ponownie.");
          return;
        }
      }

      // Create gallery entry
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: salonId!,
          employeeId: selectedEmployeeId || null,
          serviceId: selectedServiceId || null,
          afterPhotoUrl: afterUrl,
          beforePhotoUrl: beforeUrl,
          description: description || null,
          techniques: techniques || null,
          productsUsed: productsUsed || null,
          duration: uploadDuration ? parseInt(uploadDuration, 10) : null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Reset form
        setUploadFile(null);
        setUploadPreview(null);
        setBeforeFile(null);
        setBeforePreview(null);
        setDescription("");
        setSelectedEmployeeId("");
        setSelectedServiceId("");
        setTechniques("");
        setProductsUsed("");
        setUploadDuration("");
        setDialogOpen(false);
        // Refresh photos (respecting current filters)
        fetchPhotos(getActiveEmployeeFilter(), getActiveServiceFilter());
      } else {
        toast.error("Nie udalo sie dodac zdjecia. Sprobuj ponownie.");
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Nie udalo sie przeslac zdjecia. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setUploading(false);
    }
  };

  // Link a matching photo to an existing gallery entry
  const handleLinkUpload = async () => {
    if (!linkingPhoto || !linkFile) return;
    setLinkUploading(true);

    try {
      const url = await uploadFileToServer(linkFile);
      if (!url) {
        toast.error("Nie udalo sie przeslac zdjecia. Sprobuj ponownie.");
        return;
      }

      // Determine which field to update
      const isAddingBefore = !linkingPhoto.beforePhotoUrl;
      const updatePayload = isAddingBefore
        ? { beforePhotoUrl: url }
        : { afterPhotoUrl: url };

      const res = await fetch(`/api/gallery/${linkingPhoto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      const data = await res.json();
      if (data.success) {
        // Update local state
        setPhotos((prev) =>
          prev.map((p) => (p.id === linkingPhoto.id ? data.data : p))
        );
        setLinkingPhoto(null);
        setLinkFile(null);
        setLinkPreview(null);
        setSelectedPhoto(null);
      } else {
        toast.error("Nie udalo sie polaczyc zdjec. Sprobuj ponownie.");
      }
    } catch (error) {
      console.error("Link error:", error);
      toast.error("Nie udalo sie polaczyc zdjec. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setLinkUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/gallery/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
        setDeleteConfirm(null);
        setSelectedPhoto(null);
      }
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const openEditDialog = (photo: GalleryPhoto) => {
    setEditingPhoto(photo);
    setEditDescription(photo.description || "");
    setEditTechniques(photo.techniques || "");
    setEditProductsUsed(photo.productsUsed || "");
    setEditEmployeeId(photo.employeeId || "");
    setEditServiceId(photo.serviceId || "");
    setEditDuration(photo.duration ? String(photo.duration) : "");
    setEditShowProductsToClients(photo.showProductsToClients ?? true);
    setSelectedPhoto(null); // Close detail dialog
  };

  const handleSaveEdit = async () => {
    if (!editingPhoto) return;
    setEditSaving(true);

    try {
      const res = await fetch(`/api/gallery/${editingPhoto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editDescription,
          techniques: editTechniques,
          productsUsed: editProductsUsed,
          employeeId: editEmployeeId && editEmployeeId !== "none" ? editEmployeeId : null,
          serviceId: editServiceId && editServiceId !== "none" ? editServiceId : null,
          duration: editDuration ? parseInt(editDuration, 10) : null,
          showProductsToClients: editShowProductsToClients,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Update photo in local state
        setPhotos((prev) =>
          prev.map((p) => (p.id === editingPhoto.id ? data.data : p))
        );
        setEditingPhoto(null);
      } else {
        toast.error("Nie udalo sie zapisac zmian. Sprobuj ponownie.");
      }
    } catch (error) {
      console.error("Edit error:", error);
      toast.error("Nie udalo sie zapisac zmian. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setEditSaving(false);
    }
  };

  const openLinkDialog = (photo: GalleryPhoto) => {
    setLinkingPhoto(photo);
    setLinkFile(null);
    setLinkPreview(null);
    setSelectedPhoto(null);
  };

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
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Dodaj zdjecie
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Dodaj zdjecie do galerii</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* Before photo */}
              <div>
                <Label className="mb-2 block">
                  Zdjecie PRZED zabiegem
                </Label>
                <input
                  ref={beforeInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => handleFileChange(e, "before")}
                  className="hidden"
                />
                {beforePreview ? (
                  <div className="relative">
                    <img
                      src={beforePreview}
                      alt="Podglad przed"
                      className="w-full h-40 object-cover rounded-lg border"
                    />
                    <div className="absolute top-2 left-2 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded">
                      PRZED
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        setBeforeFile(null);
                        setBeforePreview(null);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => beforeInputRef.current?.click()}
                    className="w-full h-40 border-2 border-dashed border-orange-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-orange-500 transition-colors bg-orange-50/50"
                  >
                    <Upload className="w-6 h-6 text-orange-400" />
                    <span className="text-sm text-orange-600 font-medium">
                      Zdjecie PRZED
                    </span>
                    <span className="text-xs text-muted-foreground">
                      JPEG, PNG, WebP, GIF (max 10MB)
                    </span>
                  </button>
                )}
              </div>

              {/* After photo */}
              <div>
                <Label className="mb-2 block">
                  Zdjecie PO zabiegu
                </Label>
                <input
                  ref={afterInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => handleFileChange(e, "after")}
                  className="hidden"
                />
                {uploadPreview ? (
                  <div className="relative">
                    <img
                      src={uploadPreview}
                      alt="Podglad po"
                      className="w-full h-40 object-cover rounded-lg border"
                    />
                    <div className="absolute top-2 left-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded">
                      PO
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        setUploadFile(null);
                        setUploadPreview(null);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => afterInputRef.current?.click()}
                    className="w-full h-40 border-2 border-dashed border-green-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-green-500 transition-colors bg-green-50/50"
                  >
                    <Upload className="w-6 h-6 text-green-400" />
                    <span className="text-sm text-green-600 font-medium">
                      Zdjecie PO
                    </span>
                    <span className="text-xs text-muted-foreground">
                      JPEG, PNG, WebP, GIF (max 10MB)
                    </span>
                  </button>
                )}
              </div>

              {/* Pair preview */}
              {beforePreview && uploadPreview && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Link2 className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Para przed/po zostanie polaczona</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <img src={beforePreview} alt="Przed" className="w-full h-20 object-cover rounded border" />
                      <span className="absolute bottom-1 left-1 bg-orange-500 text-white text-[10px] px-1 rounded">PRZED</span>
                    </div>
                    <div className="relative">
                      <img src={uploadPreview} alt="Po" className="w-full h-20 object-cover rounded border" />
                      <span className="absolute bottom-1 left-1 bg-green-500 text-white text-[10px] px-1 rounded">PO</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Info about partial uploads */}
              {!beforePreview && !uploadPreview && (
                <p className="text-xs text-muted-foreground text-center">
                  Mozesz dodac samo zdjecie &quot;przed&quot; lub &quot;po&quot;, a drugie dolaczyc pozniej
                </p>
              )}

              {/* Employee selection */}
              <div>
                <Label className="mb-2 block">Pracownik</Label>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz pracownika" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Service selection */}
              <div>
                <Label className="mb-2 block">Usluga</Label>
                <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz usluge" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((svc) => (
                      <SelectItem key={svc.id} value={svc.id}>
                        {svc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div>
                <Label className="mb-2 block">Opis</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Opis zabiegu, efektu..."
                  rows={2}
                />
              </div>

              {/* Techniques */}
              <div>
                <Label className="mb-2 block">Techniki</Label>
                <Input
                  value={techniques}
                  onChange={(e) => setTechniques(e.target.value)}
                  placeholder="Uzyte techniki"
                />
              </div>

              {/* Products used */}
              <div>
                <Label className="mb-2 block">Uzyte produkty</Label>
                <Input
                  value={productsUsed}
                  onChange={(e) => setProductsUsed(e.target.value)}
                  placeholder="Produkty uzyte podczas zabiegu"
                />
              </div>

              {/* Duration */}
              <div>
                <Label className="mb-2 block">Czas trwania (minuty)</Label>
                <Input
                  type="number"
                  min="1"
                  value={uploadDuration}
                  onChange={(e) => setUploadDuration(e.target.value)}
                  placeholder="np. 60"
                />
              </div>

              <Button
                onClick={handleUpload}
                disabled={(!uploadFile && !beforeFile) || uploading}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Przesylanie...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    {beforeFile && uploadFile
                      ? "Dodaj pare przed/po"
                      : beforeFile
                      ? "Dodaj zdjecie (przed)"
                      : "Dodaj zdjecie (po)"}
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
          onClick={() => { setActiveTab("photos"); setViewingAlbum(null); }}
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
          onClick={() => { setActiveTab("albums"); setViewingAlbum(null); }}
        >
          <Folder className="w-4 h-4 inline-block mr-2" />
          Albumy ({albumsList.length})
        </button>
      </div>

      {/* Albums tab content */}
      {activeTab === "albums" && !viewingAlbum && (
        <div>
          {albumsLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : albumsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Folder className="w-16 h-16 text-muted-foreground mb-4" />
              <h2 className="text-lg font-semibold mb-2">Brak albumow</h2>
              <p className="text-muted-foreground mb-4">
                Utworz pierwszy album, aby pogrupowac zdjecia
              </p>
              <Button onClick={() => setCreateAlbumOpen(true)}>
                <FolderPlus className="w-4 h-4 mr-2" />
                Nowy album
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {albumsList.map((album) => (
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

      {/* Album detail view */}
      {activeTab === "albums" && viewingAlbum && (
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
                    onClick={() => setSelectedPhoto(photo)}
                  >
                    <div className="aspect-square relative">
                      {isPair ? (
                        <div className="w-full h-full flex">
                          <div className="w-1/2 h-full relative overflow-hidden">
                            <img src={photo.beforePhotoUrl!} alt="Przed" className="absolute inset-0 w-[200%] h-full object-cover" />
                          </div>
                          <div className="w-0.5 bg-white z-10 relative" />
                          <div className="w-1/2 h-full relative overflow-hidden">
                            <img src={photo.afterPhotoUrl!} alt="Po" className="absolute inset-0 w-[200%] h-full object-cover object-right" />
                          </div>
                        </div>
                      ) : photo.afterPhotoUrl ? (
                        <img src={photo.afterPhotoUrl} alt={photo.description || "Zdjecie"} className="w-full h-full object-cover" />
                      ) : photo.beforePhotoUrl ? (
                        <img src={photo.beforePhotoUrl} alt={photo.description || "Zdjecie"} className="w-full h-full object-cover" />
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

      {/* Photos tab: Filter bar */}
      {activeTab === "photos" && (
      <>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="w-4 h-4" />
          <span>Filtry:</span>
        </div>
        <Select value={filterEmployeeId || "all"} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Wszyscy pracownicy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Wszyscy pracownicy
              </span>
            </SelectItem>
            {employees.map((emp) => (
              <SelectItem key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterServiceId || "all"} onValueChange={handleServiceFilterChange}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Wszystkie uslugi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-2">
                <Scissors className="w-4 h-4" />
                Wszystkie uslugi
              </span>
            </SelectItem>
            {services.map((svc) => (
              <SelectItem key={svc.id} value={svc.id}>
                {svc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={filterPairsOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterPairsOnly(!filterPairsOnly)}
          className="gap-1"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Tylko pary
        </Button>
        {((filterEmployeeId && filterEmployeeId !== "all") || (filterServiceId && filterServiceId !== "all") || filterPairsOnly) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterEmployeeId("");
              setFilterServiceId("");
              setFilterPairsOnly(false);
              setLoading(true);
              fetchPhotos();
            }}
          >
            <X className="w-4 h-4 mr-1" />
            Wyczysc filtry
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {displayPhotos.length} {displayPhotos.length === 1 ? "zdjecie" : "zdjec"}
        </span>
      </div>

      {/* Gallery grid */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : displayPhotos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ImageIcon className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">
            {filterPairsOnly ? "Brak par przed/po" : "Galeria jest pusta"}
          </h2>
          <p className="text-muted-foreground mb-4">
            {filterPairsOnly
              ? "Dodaj zdjecia przed i po zabiegu, aby utworzyc pary"
              : "Dodaj pierwsze zdjecie do portfolio salonu"}
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Dodaj zdjecie
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayPhotos.map((photo) => {
            const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;
            const isBeforeOnly = photo.beforePhotoUrl && !photo.afterPhotoUrl;
            const isAfterOnly = !photo.beforePhotoUrl && photo.afterPhotoUrl;

            return (
              <div
                key={photo.id}
                className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                onClick={() => setSelectedPhoto(photo)}
              >
                <div className="aspect-square relative">
                  {isPair ? (
                    /* Show split preview for pairs */
                    <div className="w-full h-full flex">
                      <div className="w-1/2 h-full relative overflow-hidden">
                        <img
                          src={photo.beforePhotoUrl!}
                          alt="Przed"
                          className="absolute inset-0 w-[200%] h-full object-cover"
                        />
                      </div>
                      <div className="w-0.5 bg-white z-10 relative" />
                      <div className="w-1/2 h-full relative overflow-hidden">
                        <img
                          src={photo.afterPhotoUrl!}
                          alt="Po"
                          className="absolute inset-0 w-[200%] h-full object-cover object-right"
                        />
                      </div>
                    </div>
                  ) : photo.afterPhotoUrl ? (
                    <img
                      src={photo.afterPhotoUrl}
                      alt={photo.description || "Zdjecie galerii"}
                      className="w-full h-full object-cover"
                    />
                  ) : photo.beforePhotoUrl ? (
                    <img
                      src={photo.beforePhotoUrl}
                      alt={photo.description || "Zdjecie galerii"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageIcon className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}

                  {/* Badges */}
                  {isPair && (
                    <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                      <SlidersHorizontal className="w-3 h-3" />
                      Przed / Po
                    </div>
                  )}
                  {isBeforeOnly && (
                    <div className="absolute top-2 left-2 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded">
                      Przed
                    </div>
                  )}
                  {isAfterOnly && (
                    <div className="absolute top-2 left-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded">
                      Po
                    </div>
                  )}
                </div>

                <div className="p-3">
                  {photo.employeeFirstName && (
                    <p className="text-sm font-medium">
                      {photo.employeeFirstName} {photo.employeeLastName}
                    </p>
                  )}
                  {photo.serviceName && (
                    <p className="text-xs text-muted-foreground">{photo.serviceName}</p>
                  )}
                  {photo.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {photo.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {new Date(photo.createdAt).toLocaleDateString("pl-PL")}
                    </p>
                    {photo.productsUsed && !photo.showProductsToClients && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded" title="Produkty ukryte przed klientami">
                        <EyeOff className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Action button overlays */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Link button for incomplete pairs */}
                  {(isBeforeOnly || isAfterOnly) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinkDialog(photo);
                      }}
                      className="bg-blue-500/80 text-white p-1.5 rounded hover:bg-blue-600/90 transition-colors"
                      title={isBeforeOnly ? "Dodaj zdjecie 'po'" : "Dodaj zdjecie 'przed'"}
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddToAlbumPhotoId(photo.id);
                      setAddToAlbumDialogOpen(true);
                    }}
                    className="bg-purple-500/80 text-white p-1.5 rounded hover:bg-purple-600/90 transition-colors"
                    title="Dodaj do albumu"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditDialog(photo);
                    }}
                    className="bg-blue-500/80 text-white p-1.5 rounded hover:bg-blue-600/90 transition-colors"
                    title="Edytuj zdjecie"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(photo.id);
                    }}
                    className="bg-red-500/80 text-white p-1.5 rounded hover:bg-red-600/90 transition-colors"
                    title="Usun zdjecie"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Photo detail dialog */}
      {selectedPhoto && (
        <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] p-0">
            <div className="overflow-y-auto max-h-[calc(90vh-4rem)] p-6">
            <DialogHeader>
              <DialogTitle>
                {selectedPhoto.description || "Zdjecie galerii"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {/* Before/After comparison */}
              {selectedPhoto.beforePhotoUrl && selectedPhoto.afterPhotoUrl ? (
                <div>
                  {/* Comparison mode toggle */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-medium">Widok porownania:</span>
                    <Button
                      variant={comparisonMode === "slider" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setComparisonMode("slider")}
                    >
                      <SlidersHorizontal className="w-4 h-4 mr-1" />
                      Suwak
                    </Button>
                    <Button
                      variant={comparisonMode === "side-by-side" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setComparisonMode("side-by-side")}
                    >
                      Obok siebie
                    </Button>
                  </div>

                  {comparisonMode === "slider" ? (
                    <ComparisonSlider
                      beforeUrl={selectedPhoto.beforePhotoUrl}
                      afterUrl={selectedPhoto.afterPhotoUrl}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium mb-2 text-center bg-orange-100 text-orange-700 rounded py-1">Przed</p>
                        <img
                          src={selectedPhoto.beforePhotoUrl}
                          alt="Przed"
                          className="w-full rounded-lg"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-2 text-center bg-green-100 text-green-700 rounded py-1">Po</p>
                        <img
                          src={selectedPhoto.afterPhotoUrl}
                          alt="Po"
                          className="w-full rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {/* Single photo with option to add matching */}
                  <img
                    src={selectedPhoto.afterPhotoUrl || selectedPhoto.beforePhotoUrl || ""}
                    alt={selectedPhoto.description || "Zdjecie"}
                    className="w-full max-h-[50vh] object-contain rounded-lg"
                  />
                  {/* Show badge for single photos */}
                  {selectedPhoto.beforePhotoUrl && !selectedPhoto.afterPhotoUrl && (
                    <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded">PRZED</span>
                        <span className="text-sm text-orange-700">Brak zdjecia &quot;po&quot; - dodaj aby utworzyc pare</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openLinkDialog(selectedPhoto)}
                      >
                        <Link2 className="w-4 h-4 mr-1" />
                        Dodaj &quot;po&quot;
                      </Button>
                    </div>
                  )}
                  {!selectedPhoto.beforePhotoUrl && selectedPhoto.afterPhotoUrl && (
                    <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded">PO</span>
                        <span className="text-sm text-green-700">Brak zdjecia &quot;przed&quot; - dodaj aby utworzyc pare</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openLinkDialog(selectedPhoto)}
                      >
                        <Link2 className="w-4 h-4 mr-1" />
                        Dodaj &quot;przed&quot;
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {selectedPhoto.employeeFirstName && (
                  <p className="text-sm">
                    <span className="font-medium">Pracownik:</span>{" "}
                    {selectedPhoto.employeeFirstName} {selectedPhoto.employeeLastName}
                  </p>
                )}
                {selectedPhoto.serviceName && (
                  <p className="text-sm">
                    <span className="font-medium">Usluga:</span> {selectedPhoto.serviceName}
                  </p>
                )}
                {selectedPhoto.techniques && (
                  <p className="text-sm">
                    <span className="font-medium">Techniki:</span> {selectedPhoto.techniques}
                  </p>
                )}
                {selectedPhoto.productsUsed && (
                  <div className="text-sm">
                    <span className="font-medium">Produkty:</span> {selectedPhoto.productsUsed}
                    <span className="ml-2 inline-flex items-center gap-1 text-xs">
                      {selectedPhoto.showProductsToClients ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <Eye className="w-3 h-3" /> widoczne dla klientow
                        </span>
                      ) : (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <EyeOff className="w-3 h-3" /> ukryte przed klientami
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {selectedPhoto.duration && (
                  <p className="text-sm">
                    <span className="font-medium">Czas trwania:</span> {selectedPhoto.duration} min
                  </p>
                )}
                {selectedPhoto.description && (
                  <p className="text-sm">
                    <span className="font-medium">Opis:</span> {selectedPhoto.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Dodano: {new Date(selectedPhoto.createdAt).toLocaleDateString("pl-PL", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    openCaptionDialog(selectedPhoto);
                    setSelectedPhoto(null);
                  }}
                  className="text-purple-600 border-purple-200 hover:bg-purple-50"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generuj post
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAddToAlbumPhotoId(selectedPhoto.id);
                    setAddToAlbumDialogOpen(true);
                    setSelectedPhoto(null);
                  }}
                >
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Do albumu
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(selectedPhoto)}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Edytuj
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setDeleteConfirm(selectedPhoto.id);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Usun zdjecie
                </Button>
              </div>
            </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Link matching photo dialog */}
      {linkingPhoto && (
        <Dialog open={!!linkingPhoto} onOpenChange={() => { setLinkingPhoto(null); setLinkFile(null); setLinkPreview(null); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {linkingPhoto.beforePhotoUrl && !linkingPhoto.afterPhotoUrl
                  ? "Dodaj zdjecie PO zabiegu"
                  : "Dodaj zdjecie PRZED zabiegiem"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {/* Show existing photo */}
              <div>
                <Label className="mb-2 block text-sm text-muted-foreground">
                  Istniejace zdjecie ({linkingPhoto.beforePhotoUrl ? "przed" : "po"}):
                </Label>
                <div className="relative">
                  <img
                    src={linkingPhoto.beforePhotoUrl || linkingPhoto.afterPhotoUrl || ""}
                    alt="Istniejace zdjecie"
                    className="w-full h-40 object-cover rounded-lg border"
                  />
                  <div className={`absolute top-2 left-2 text-white text-xs font-semibold px-2 py-1 rounded ${
                    linkingPhoto.beforePhotoUrl ? "bg-orange-500" : "bg-green-500"
                  }`}>
                    {linkingPhoto.beforePhotoUrl ? "PRZED" : "PO"}
                  </div>
                </div>
              </div>

              {/* Upload matching photo */}
              <div>
                <Label className="mb-2 block">
                  {linkingPhoto.beforePhotoUrl && !linkingPhoto.afterPhotoUrl
                    ? "Zdjecie PO zabiegu"
                    : "Zdjecie PRZED zabiegiem"}
                  <span className="text-red-500 ml-1">*</span>
                </Label>
                <input
                  ref={linkInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setLinkFile(file);
                      const reader = new FileReader();
                      reader.onload = () => setLinkPreview(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="hidden"
                />
                {linkPreview ? (
                  <div className="relative">
                    <img
                      src={linkPreview}
                      alt="Nowe zdjecie"
                      className="w-full h-40 object-cover rounded-lg border"
                    />
                    <div className={`absolute top-2 left-2 text-white text-xs font-semibold px-2 py-1 rounded ${
                      linkingPhoto.beforePhotoUrl ? "bg-green-500" : "bg-orange-500"
                    }`}>
                      {linkingPhoto.beforePhotoUrl ? "PO" : "PRZED"}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => { setLinkFile(null); setLinkPreview(null); }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => linkInputRef.current?.click()}
                    className={`w-full h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition-colors ${
                      linkingPhoto.beforePhotoUrl
                        ? "border-green-300 hover:border-green-500 bg-green-50/50"
                        : "border-orange-300 hover:border-orange-500 bg-orange-50/50"
                    }`}
                  >
                    <Upload className={`w-6 h-6 ${linkingPhoto.beforePhotoUrl ? "text-green-400" : "text-orange-400"}`} />
                    <span className={`text-sm font-medium ${linkingPhoto.beforePhotoUrl ? "text-green-600" : "text-orange-600"}`}>
                      {linkingPhoto.beforePhotoUrl ? "Zdjecie PO" : "Zdjecie PRZED"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      JPEG, PNG, WebP, GIF (max 10MB)
                    </span>
                  </button>
                )}
              </div>

              {/* Pair preview */}
              {linkPreview && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Link2 className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Podglad pary</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <img
                        src={linkingPhoto.beforePhotoUrl || linkPreview}
                        alt="Przed"
                        className="w-full h-20 object-cover rounded border"
                      />
                      <span className="absolute bottom-1 left-1 bg-orange-500 text-white text-[10px] px-1 rounded">PRZED</span>
                    </div>
                    <div className="relative">
                      <img
                        src={linkingPhoto.beforePhotoUrl ? linkPreview : (linkingPhoto.afterPhotoUrl || "")}
                        alt="Po"
                        className="w-full h-20 object-cover rounded border"
                      />
                      <span className="absolute bottom-1 left-1 bg-green-500 text-white text-[10px] px-1 rounded">PO</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setLinkingPhoto(null); setLinkFile(null); setLinkPreview(null); }}>
                  Anuluj
                </Button>
                <Button onClick={handleLinkUpload} disabled={!linkFile || linkUploading}>
                  {linkUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Laczenie...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      Polacz zdjecia
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit photo dialog */}
      {editingPhoto && (
        <Dialog open={!!editingPhoto} onOpenChange={() => setEditingPhoto(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edytuj zdjecie</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {/* Photo preview */}
              <div className="rounded-lg overflow-hidden border">
                <img
                  src={editingPhoto.afterPhotoUrl || editingPhoto.beforePhotoUrl || ""}
                  alt="Edytowane zdjecie"
                  className="w-full h-40 object-cover"
                />
              </div>

              {/* Description */}
              <div>
                <Label className="mb-2 block">Opis</Label>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Opis zabiegu, efektu..."
                  rows={2}
                />
              </div>

              {/* Techniques */}
              <div>
                <Label className="mb-2 block">Techniki</Label>
                <Input
                  value={editTechniques}
                  onChange={(e) => setEditTechniques(e.target.value)}
                  placeholder="Uzyte techniki"
                />
              </div>

              {/* Products used */}
              <div>
                <Label className="mb-2 block">Uzyte produkty</Label>
                <Input
                  value={editProductsUsed}
                  onChange={(e) => setEditProductsUsed(e.target.value)}
                  placeholder="Produkty uzyte podczas zabiegu"
                />
              </div>

              {/* Duration */}
              <div>
                <Label className="mb-2 block">Czas trwania (minuty)</Label>
                <Input
                  type="number"
                  min="1"
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                  placeholder="np. 60"
                />
              </div>

              {/* Product visibility toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30" data-testid="product-visibility-toggle">
                <div className="flex items-center gap-2">
                  {editShowProductsToClients ? (
                    <Eye className="w-4 h-4 text-green-600" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-muted-foreground" />
                  )}
                  <div>
                    <Label className="text-sm font-medium cursor-pointer">
                      Pokaz produkty klientom
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {editShowProductsToClients
                        ? "Klienci widza uzyte produkty"
                        : "Produkty ukryte przed klientami"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={editShowProductsToClients}
                  onCheckedChange={setEditShowProductsToClients}
                  data-testid="product-visibility-switch"
                />
              </div>

              {/* Employee selection */}
              <div>
                <Label className="mb-2 block">Pracownik</Label>
                <Select value={editEmployeeId} onValueChange={setEditEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz pracownika" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brak</SelectItem>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Service selection */}
              <div>
                <Label className="mb-2 block">Usluga</Label>
                <Select value={editServiceId} onValueChange={setEditServiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz usluge" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brak</SelectItem>
                    {services.map((svc) => (
                      <SelectItem key={svc.id} value={svc.id}>
                        {svc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingPhoto(null)}>
                  Anuluj
                </Button>
                <Button onClick={handleSaveEdit} disabled={editSaving}>
                  {editSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Zapisywanie...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Zapisz zmiany
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

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

      {/* Create Album dialog */}
      <Dialog open={createAlbumOpen} onOpenChange={setCreateAlbumOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nowy album</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label className="mb-2 block">Nazwa albumu</Label>
              <Input
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="np. Koloryzacje lato 2025"
                autoFocus
              />
            </div>
            <div>
              <Label className="mb-2 block">Kategoria (opcjonalnie)</Label>
              <Input
                value={newAlbumCategory}
                onChange={(e) => setNewAlbumCategory(e.target.value)}
                placeholder="np. Koloryzacja, Strzyzenie"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCreateAlbumOpen(false)}>
                Anuluj
              </Button>
              <Button onClick={handleCreateAlbum} disabled={!newAlbumName.trim() || creatingAlbum}>
                {creatingAlbum ? (
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

      {/* Add to Album dialog */}
      <Dialog open={addToAlbumDialogOpen} onOpenChange={(open) => { setAddToAlbumDialogOpen(open); if (!open) setAddToAlbumPhotoId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dodaj do albumu</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {albumsList.length === 0 ? (
              <div className="text-center py-6">
                <Folder className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Brak albumow. Utworz pierwszy album.</p>
                <Button size="sm" onClick={() => { setAddToAlbumDialogOpen(false); setCreateAlbumOpen(true); }}>
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Nowy album
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Wybierz album, do ktorego chcesz dodac zdjecie:</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {albumsList.map((album) => (
                    <button
                      key={album.id}
                      onClick={() => handleAddToAlbum(album.id)}
                      disabled={addingToAlbum}
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
                      {addingToAlbum && (
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

      {/* Delete Album confirmation dialog */}
      {deleteAlbumConfirm && (
        <Dialog open={!!deleteAlbumConfirm} onOpenChange={() => setDeleteAlbumConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Usun album</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground">
              Czy na pewno chcesz usunac album <strong>&quot;{deleteAlbumConfirm.name}&quot;</strong>?
              Zdjecia nie zostana usuniete - tylko album.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" onClick={() => setDeleteAlbumConfirm(null)}>
                Anuluj
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDeleteAlbum(deleteAlbumConfirm)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Usun album
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Generate Post Caption dialog */}
      <Dialog open={captionDialogOpen} onOpenChange={(open) => { setCaptionDialogOpen(open); if (!open) { setCaptionPhoto(null); setGeneratedCaption(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Generuj post z galerii
            </DialogTitle>
          </DialogHeader>

          {captionPhoto && (
            <div className="space-y-4 mt-4">
              {/* Photo preview */}
              <div className="flex gap-4">
                <div className="w-32 h-32 rounded-lg overflow-hidden border flex-shrink-0">
                  <img
                    src={captionPhoto.afterPhotoUrl || captionPhoto.beforePhotoUrl || ""}
                    alt={captionPhoto.description || "Zdjecie"}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  {captionPhoto.serviceName && (
                    <p className="text-sm font-medium">{captionPhoto.serviceName}</p>
                  )}
                  {captionPhoto.employeeFirstName && (
                    <p className="text-sm text-muted-foreground">
                      {captionPhoto.employeeFirstName} {captionPhoto.employeeLastName}
                    </p>
                  )}
                  {captionPhoto.techniques && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Techniki:</span> {captionPhoto.techniques}
                    </p>
                  )}
                  {captionPhoto.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{captionPhoto.description}</p>
                  )}
                  {captionPhoto.beforePhotoUrl && captionPhoto.afterPhotoUrl && (
                    <Badge variant="secondary" className="text-xs">
                      <SlidersHorizontal className="w-3 h-3 mr-1" />
                      Przed / Po
                    </Badge>
                  )}
                </div>
              </div>

              {/* Platform selection */}
              <div>
                <Label className="mb-2 block text-sm font-medium">Platforma</Label>
                <div className="flex gap-2">
                  <Button
                    variant={captionPlatform === "instagram" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCaptionPlatform("instagram")}
                    className="flex-1"
                  >
                    <Instagram className="w-4 h-4 mr-2" />
                    Instagram
                  </Button>
                  <Button
                    variant={captionPlatform === "facebook" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCaptionPlatform("facebook")}
                    className="flex-1"
                  >
                    <Facebook className="w-4 h-4 mr-2" />
                    Facebook
                  </Button>
                  <Button
                    variant={captionPlatform === "tiktok" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCaptionPlatform("tiktok")}
                    className="flex-1"
                  >
                    <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.92 2.92 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.57 6.33 6.33 0 0 0 9.37 22a6.33 6.33 0 0 0 6.45-6.21V8.73a8.16 8.16 0 0 0 4.77 1.53v-3.4a4.85 4.85 0 0 1-1-.17z" />
                    </svg>
                    TikTok
                  </Button>
                </div>
              </div>

              {/* Generate button */}
              <Button
                onClick={handleGenerateCaption}
                disabled={captionLoading}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {captionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generowanie podpisu...
                  </>
                ) : generatedCaption ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Wygeneruj ponownie
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generuj podpis
                  </>
                )}
              </Button>

              {/* Generated caption */}
              {generatedCaption && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Wygenerowany podpis</Label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {(isCaptionEditing ? editedCaption : generatedCaption).length} znakow
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleToggleCaptionEdit}
                        className="h-7"
                      >
                        <Pencil className="w-3 h-3 mr-1" />
                        {isCaptionEditing ? "Anuluj" : "Edytuj"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyCaption}
                        className="h-7"
                      >
                        {captionCopied ? (
                          <>
                            <Check className="w-3 h-3 mr-1" />
                            Skopiowano
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1" />
                            Kopiuj
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {isCaptionEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editedCaption}
                        onChange={(e) => setEditedCaption(e.target.value)}
                        rows={6}
                        className="text-sm leading-relaxed resize-y min-h-[100px]"
                        data-testid="edit-caption-textarea"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={handleSaveCaptionEdit}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Zapisz zmiany
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="p-4 bg-muted/50 rounded-lg border text-sm whitespace-pre-wrap leading-relaxed cursor-pointer hover:border-primary/50 transition-colors group relative"
                      onClick={handleToggleCaptionEdit}
                      data-testid="generated-caption"
                    >
                      {generatedCaption}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge variant="secondary" className="text-xs">
                          <Pencil className="h-3 w-3 mr-1" />
                          Edytuj
                        </Badge>
                      </div>
                    </div>
                  )}

                  {/* Hashtags */}
                  {captionHashtags.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Znalezione hashtagi ({captionHashtags.length})
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {captionHashtags.map((tag, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
