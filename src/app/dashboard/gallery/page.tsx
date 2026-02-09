"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Trash2, Image as ImageIcon, Plus, X, Loader2 } from "lucide-react";
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
import { useSession } from "@/lib/auth-client";

const SALON_ID = "00000000-0000-0000-0000-000000000001";

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

export default function GalleryPage() {
  const { data: session, isPending } = useSession();
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
  const afterInputRef = useRef<HTMLInputElement>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/gallery?salonId=${SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setPhotos(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch photos:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees?salonId=${SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
    }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch(`/api/services?salonId=${SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch services:", error);
    }
  }, []);

  useEffect(() => {
    fetchPhotos();
    fetchEmployees();
    fetchServices();
  }, [fetchPhotos, fetchEmployees, fetchServices]);

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
    if (!uploadFile) return;
    setUploading(true);

    try {
      // Upload after photo (required)
      const afterUrl = await uploadFileToServer(uploadFile);
      if (!afterUrl) {
        alert("Nie udalo sie przeslac zdjecia");
        return;
      }

      // Upload before photo (optional)
      let beforeUrl: string | null = null;
      if (beforeFile) {
        beforeUrl = await uploadFileToServer(beforeFile);
      }

      // Create gallery entry
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: SALON_ID,
          employeeId: selectedEmployeeId || null,
          serviceId: selectedServiceId || null,
          afterPhotoUrl: afterUrl,
          beforePhotoUrl: beforeUrl,
          description: description || null,
          techniques: techniques || null,
          productsUsed: productsUsed || null,
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
        setDialogOpen(false);
        // Refresh photos
        fetchPhotos();
      } else {
        alert("Blad przy dodawaniu zdjecia: " + data.error);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Blad przy przesylaniu zdjecia");
    } finally {
      setUploading(false);
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

  if (isPending) {
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
              {/* After photo (required) */}
              <div>
                <Label className="mb-2 block">
                  Zdjecie (po zabiegu) <span className="text-red-500">*</span>
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
                      alt="Podglad"
                      className="w-full h-48 object-cover rounded-lg border"
                    />
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
                    className="w-full h-48 border-2 border-dashed border-muted-foreground/25 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors"
                  >
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Kliknij aby wybrac zdjecie
                    </span>
                    <span className="text-xs text-muted-foreground">
                      JPEG, PNG, WebP, GIF (max 10MB)
                    </span>
                  </button>
                )}
              </div>

              {/* Before photo (optional) */}
              <div>
                <Label className="mb-2 block">Zdjecie (przed zabiegem) - opcjonalne</Label>
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
                      className="w-full h-32 object-cover rounded-lg border"
                    />
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
                    className="w-full h-32 border-2 border-dashed border-muted-foreground/25 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors"
                  >
                    <Upload className="w-6 h-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Przed zabiegem (opcjonalne)
                    </span>
                  </button>
                )}
              </div>

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

              <Button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
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
                    Dodaj do galerii
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Gallery grid */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ImageIcon className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">Galeria jest pusta</h2>
          <p className="text-muted-foreground mb-4">
            Dodaj pierwsze zdjecie do portfolio salonu
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Dodaj zdjecie
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
              onClick={() => setSelectedPhoto(photo)}
            >
              <div className="aspect-square relative">
                {photo.afterPhotoUrl ? (
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

                {/* Before/After badge */}
                {photo.beforePhotoUrl && photo.afterPhotoUrl && (
                  <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                    Przed / Po
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
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(photo.createdAt).toLocaleDateString("pl-PL")}
                </p>
              </div>

              {/* Delete button overlay */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(photo.id);
                }}
                className="absolute top-2 right-2 bg-red-500/80 text-white p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Photo detail dialog */}
      {selectedPhoto && (
        <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedPhoto.description || "Zdjecie galerii"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {/* Before/After comparison */}
              {selectedPhoto.beforePhotoUrl && selectedPhoto.afterPhotoUrl ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium mb-2 text-center">Przed</p>
                    <img
                      src={selectedPhoto.beforePhotoUrl}
                      alt="Przed"
                      className="w-full rounded-lg"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2 text-center">Po</p>
                    <img
                      src={selectedPhoto.afterPhotoUrl}
                      alt="Po"
                      className="w-full rounded-lg"
                    />
                  </div>
                </div>
              ) : (
                <img
                  src={selectedPhoto.afterPhotoUrl || selectedPhoto.beforePhotoUrl || ""}
                  alt={selectedPhoto.description || "Zdjecie"}
                  className="w-full rounded-lg"
                />
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
                  <p className="text-sm">
                    <span className="font-medium">Produkty:</span> {selectedPhoto.productsUsed}
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

              <div className="flex gap-2 justify-end">
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
    </div>
  );
}
