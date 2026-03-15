import { Badge } from "@/components/ui/badge";

export function getMarginColor(margin: number) {
  if (margin >= 70) return "text-green-700";
  if (margin >= 50) return "text-green-600";
  if (margin >= 30) return "text-yellow-600";
  if (margin >= 0) return "text-orange-600";
  return "text-red-600";
}

export function getMarginBadge(margin: number) {
  if (margin >= 70)
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        Wysoka
      </Badge>
    );
  if (margin >= 50)
    return (
      <Badge className="bg-green-50 text-green-700 hover:bg-green-50">
        Dobra
      </Badge>
    );
  if (margin >= 30)
    return (
      <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
        Srednia
      </Badge>
    );
  if (margin >= 0)
    return (
      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
        Niska
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
      Strata
    </Badge>
  );
}
