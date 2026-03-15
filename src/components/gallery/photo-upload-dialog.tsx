"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2, Link2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Employee, Service } from "./gallery-types";

interface PhotoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  services: Service[];
  salonId: string;
  /** Called after successful upload so the parent can refresh data */
  onUploadComplete: () => void;
}

/**
 * Uploads a file to the gallery upload endpoint, returning the URL on success.
 */
async function uploadFileToServer(file: File): Promise<string | null> {
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
}

export function PhotoUploadDialog({
  open,
  onOpenChange,
  employees,
  services,
  salonId,
  onUploadComplete,
}: PhotoUploadDialogProps) {
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
  const [uploading, setUploading] = useState(false);

  const afterInputRef = useRef<HTMLInputElement>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);

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

  const resetForm = () => {
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
          salonId,
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
        resetForm();
        onOpenChange(false);
        onUploadComplete();
      } else {
        toast.error("Nie udalo sie dodac zdjecia. Sprobuj ponownie.");
      }
    } catch {
      toast.error("Nie udalo sie przeslac zdjecia. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                {/* eslint-disable-next-line @next/next/no-img-element -- data URI from FileReader */}
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
                {/* eslint-disable-next-line @next/next/no-img-element -- data URI from FileReader */}
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
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URI from FileReader */}
                  <img src={beforePreview} alt="Przed" className="w-full h-20 object-cover rounded border" />
                  <span className="absolute bottom-1 left-1 bg-orange-500 text-white text-[10px] px-1 rounded">PRZED</span>
                </div>
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URI from FileReader */}
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
  );
}
