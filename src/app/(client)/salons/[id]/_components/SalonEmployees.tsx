"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Users,
  Star,
  Scissors,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EmployeeProfile } from "../_types";

interface SalonEmployeesProps {
  employees: EmployeeProfile[];
  salonId: string;
}

export function SalonEmployees({ employees, salonId }: SalonEmployeesProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="w-5 h-5" />
          Zespol ({employees.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Brak informacji o zespole
          </p>
        ) : (
          <div className="space-y-3">
            {employees.map((emp) => (
              <Link
                key={emp.id}
                href={`/salons/${salonId}/employees/${emp.id}`}
                className="block"
                data-testid={`employee-card-${emp.id}`}
              >
                <div className="flex items-start gap-3 py-3 px-2 border rounded-lg hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
                  {/* Employee Photo / Avatar */}
                  {emp.photoUrl ? (
                    <div className="relative w-12 h-12 flex-shrink-0">
                      <Image
                        src={emp.photoUrl}
                        alt={`${emp.firstName} ${emp.lastName}`}
                        fill
                        className="rounded-full object-cover"
                        sizes="48px"
                      />
                    </div>
                  ) : (
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                      style={{
                        backgroundColor: emp.color || "#3b82f6",
                      }}
                    >
                      {emp.firstName.charAt(0)}
                      {emp.lastName.charAt(0)}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {/* Name */}
                    <p className="font-medium text-sm" data-testid={`employee-name-${emp.id}`}>
                      {emp.firstName} {emp.lastName}
                    </p>

                    {/* Role */}
                    <p className="text-xs text-muted-foreground capitalize">
                      {emp.role === "owner"
                        ? "Wlasciciel"
                        : emp.role === "employee"
                          ? "Pracownik"
                          : emp.role === "receptionist"
                            ? "Recepcja"
                            : emp.role}
                    </p>

                    {/* Specialties */}
                    {emp.specialties && emp.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5" data-testid={`employee-specialties-${emp.id}`}>
                        {emp.specialties.slice(0, 3).map((spec, idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            {spec}
                          </Badge>
                        ))}
                        {emp.specialties.length > 3 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
                            +{emp.specialties.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Rating + Stats */}
                    <div className="flex items-center gap-3 mt-1.5">
                      {emp.averageRating !== null && emp.averageRating > 0 && (
                        <div className="flex items-center gap-1" data-testid={`employee-rating-${emp.id}`}>
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-xs font-medium">
                            {emp.averageRating.toFixed(1)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({emp.reviewCount})
                          </span>
                        </div>
                      )}
                      {emp.galleryCount > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Scissors className="w-3 h-3" />
                          <span>
                            {emp.galleryCount} {emp.galleryCount === 1 ? "praca" : "prac"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
