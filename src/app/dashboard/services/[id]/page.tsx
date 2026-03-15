"use client";

import { useParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Lock } from "lucide-react";
import { useSalonId } from "@/hooks/use-salon-id";

import { useServiceData } from "./_hooks/use-service-data";
import { useVariantForm } from "./_hooks/use-variant-form";
import { useEditService } from "./_hooks/use-edit-service";
import { useEmployeePricing } from "./_hooks/use-employee-pricing";
import { useProductLinks } from "./_hooks/use-product-links";

import { ServiceHeader } from "./_components/service-header";
import { ServiceDetailsCard } from "./_components/service-details-card";
import { VariantsCard } from "./_components/variants-card";
import { EmployeeAssignmentCard } from "./_components/employee-assignment-card";
import { EmployeePricingCard } from "./_components/employee-pricing-card";
import { LinkedProductsCard } from "./_components/linked-products-card";
import { GalleryPhotosCard } from "./_components/gallery-photos-card";
import dynamic from "next/dynamic";

const EditServiceDialog = dynamic(() => import("./_components/edit-service-dialog").then((m) => m.EditServiceDialog));

export default function ServiceDetailPage() {
  const params = useParams();
  const serviceId = params.id as string;
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  // Data fetching
  const {
    service,
    loading,
    assignedEmployeeIds,
    setAssignedEmployeeIds,
    employeePrices,
    allEmployees,
    serviceProductLinks,
    allProducts,
    galleryPhotos,
    refetchService,
    refetchEmployeePrices,
    refetchServiceProductLinks,
  } = useServiceData({ serviceId, salonId });

  // Variant form
  const variantForm = useVariantForm({
    serviceId,
    onSuccess: refetchService,
  });

  // Edit service form
  const editService = useEditService({
    serviceId,
    service,
    salonId,
    onSuccess: refetchService,
  });

  // Employee pricing form
  const empPricing = useEmployeePricing({
    serviceId,
    allEmployees,
    onSuccess: refetchEmployeePrices,
  });

  // Product links form
  const productLinks = useProductLinks({
    serviceId,
    allProducts,
    onSuccess: refetchServiceProductLinks,
  });

  // Loading state
  if (isPending || salonLoading || loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Auth guard
  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby zarzadzac uslugami
          </p>
        </div>
      </div>
    );
  }

  // Service not found
  if (!service) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono uslugi</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <ServiceHeader
        service={service}
        onEdit={editService.openEditServiceDialog}
        onDelete={editService.handleDeleteService}
        deletingService={editService.deletingService}
        deleteDialogOpen={editService.deleteDialogOpen}
        setDeleteDialogOpen={editService.setDeleteDialogOpen}
      />

      <ServiceDetailsCard service={service} />

      <VariantsCard
        service={service}
        variantDialogOpen={variantForm.variantDialogOpen}
        setVariantDialogOpen={variantForm.setVariantDialogOpen}
        editingVariant={variantForm.editingVariant}
        variantName={variantForm.variantName}
        setVariantName={variantForm.setVariantName}
        variantPriceModifier={variantForm.variantPriceModifier}
        setVariantPriceModifier={variantForm.setVariantPriceModifier}
        variantDurationModifier={variantForm.variantDurationModifier}
        setVariantDurationModifier={variantForm.setVariantDurationModifier}
        savingVariant={variantForm.savingVariant}
        variantErrors={variantForm.variantErrors}
        setVariantErrors={variantForm.setVariantErrors}
        clearVariantError={variantForm.clearVariantError}
        resetVariantForm={variantForm.resetVariantForm}
        openEditVariant={variantForm.openEditVariant}
        handleSaveVariant={variantForm.handleSaveVariant}
        handleDeleteVariant={variantForm.handleDeleteVariant}
      />

      <EmployeeAssignmentCard
        serviceId={serviceId}
        allEmployees={allEmployees}
        assignedEmployeeIds={assignedEmployeeIds}
        setAssignedEmployeeIds={setAssignedEmployeeIds}
      />

      <EmployeePricingCard
        service={service}
        employeePrices={employeePrices}
        allEmployees={allEmployees}
        empPriceDialogOpen={empPricing.empPriceDialogOpen}
        setEmpPriceDialogOpen={empPricing.setEmpPriceDialogOpen}
        empPriceEmployeeId={empPricing.empPriceEmployeeId}
        setEmpPriceEmployeeId={empPricing.setEmpPriceEmployeeId}
        empPriceCustomPrice={empPricing.empPriceCustomPrice}
        setEmpPriceCustomPrice={empPricing.setEmpPriceCustomPrice}
        savingEmpPrice={empPricing.savingEmpPrice}
        resetEmpPriceForm={empPricing.resetEmpPriceForm}
        handleSaveEmployeePrice={empPricing.handleSaveEmployeePrice}
        handleDeleteEmployeePrice={empPricing.handleDeleteEmployeePrice}
      />

      <LinkedProductsCard
        serviceProductLinks={serviceProductLinks}
        allProducts={allProducts}
        productLinkDialogOpen={productLinks.productLinkDialogOpen}
        setProductLinkDialogOpen={productLinks.setProductLinkDialogOpen}
        productLinkProductId={productLinks.productLinkProductId}
        setProductLinkProductId={productLinks.setProductLinkProductId}
        productLinkQuantity={productLinks.productLinkQuantity}
        setProductLinkQuantity={productLinks.setProductLinkQuantity}
        savingProductLink={productLinks.savingProductLink}
        resetProductLinkForm={productLinks.resetProductLinkForm}
        handleSaveProductLink={productLinks.handleSaveProductLink}
        handleDeleteProductLink={productLinks.handleDeleteProductLink}
      />

      <GalleryPhotosCard galleryPhotos={galleryPhotos} />

      <EditServiceDialog
        editServiceDialogOpen={editService.editServiceDialogOpen}
        setEditServiceDialogOpen={editService.setEditServiceDialogOpen}
        editServiceName={editService.editServiceName}
        setEditServiceName={editService.setEditServiceName}
        editServiceDescription={editService.editServiceDescription}
        setEditServiceDescription={editService.setEditServiceDescription}
        editServicePrice={editService.editServicePrice}
        setEditServicePrice={editService.setEditServicePrice}
        editServiceDuration={editService.editServiceDuration}
        setEditServiceDuration={editService.setEditServiceDuration}
        editServiceIsActive={editService.editServiceIsActive}
        setEditServiceIsActive={editService.setEditServiceIsActive}
        savingService={editService.savingService}
        editServiceErrors={editService.editServiceErrors}
        clearEditServiceError={editService.clearEditServiceError}
        generatingDescription={editService.generatingDescription}
        handleSaveService={editService.handleSaveService}
        handleGenerateDescription={editService.handleGenerateDescription}
      />
    </div>
  );
}
