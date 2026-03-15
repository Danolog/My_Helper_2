"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Award,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Gift,
  Percent,
  Scissors,
  ShoppingBag,
  History,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mutationFetch } from "@/lib/api-client";
import type { LoyaltyData, RewardsData, RewardItem } from "./types";

interface ClientLoyaltyTabProps {
  clientId: string;
  salonId: string;
}

/**
 * Loyalty points tab for the client detail page.
 * Displays points balance, available rewards with redemption,
 * and transaction history. Fetches all data independently on mount.
 */
export function ClientLoyaltyTab({ clientId, salonId }: ClientLoyaltyTabProps) {
  const [loyaltyData, setLoyaltyData] = useState<LoyaltyData | null>(null);
  const [loadingLoyalty, setLoadingLoyalty] = useState(false);
  const [rewardsData, setRewardsData] = useState<RewardsData | null>(null);
  const [loadingRewards, setLoadingRewards] = useState(false);

  // Rewards redemption state
  const [redeemingReward, setRedeemingReward] = useState(false);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<RewardItem | null>(null);

  const fetchLoyaltyData = useCallback(async (signal: AbortSignal | null = null) => {
    setLoadingLoyalty(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/loyalty?salonId=${salonId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setLoyaltyData(data.data as LoyaltyData);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingLoyalty(false);
    }
  }, [salonId, clientId]);

  const fetchRewardsData = useCallback(async (signal: AbortSignal | null = null) => {
    setLoadingRewards(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/loyalty/redeem?salonId=${salonId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setRewardsData(data.data as RewardsData);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingRewards(false);
    }
  }, [salonId, clientId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchLoyaltyData(controller.signal);
    fetchRewardsData(controller.signal);
    return () => controller.abort();
  }, [fetchLoyaltyData, fetchRewardsData]);

  const handleRedeemReward = async () => {
    if (!selectedReward) return;
    setRedeemingReward(true);
    try {
      const res = await mutationFetch(`/api/clients/${clientId}/loyalty/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardTierId: selectedReward.id,
          salonId: salonId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Nagroda zrealizowana!");
        // Refresh loyalty data and rewards
        await Promise.all([fetchLoyaltyData(), fetchRewardsData()]);
      } else {
        toast.error(data.error || "Nie udalo sie zrealizowac nagrody");
      }
    } catch {
      toast.error("Blad podczas realizacji nagrody");
    } finally {
      setRedeemingReward(false);
      setRedeemDialogOpen(false);
      setSelectedReward(null);
    }
  };

  const openRedeemDialog = (reward: RewardItem) => {
    setSelectedReward(reward);
    setRedeemDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Points Balance Card */}
      <Card data-testid="loyalty-balance-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-lg">Saldo punktow lojalnosciowych</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingLoyalty ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-950/40">
                  <TrendingUp className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-4xl font-bold text-amber-600 dark:text-amber-400" data-testid="loyalty-points-balance">
                    {loyaltyData?.points ?? 0}
                  </p>
                  <p className="text-sm text-muted-foreground">punktow</p>
                </div>
              </div>
              {loyaltyData?.lastUpdated && (
                <div className="text-sm text-muted-foreground">
                  <p>Ostatnia aktualizacja:</p>
                  <p>{new Date(loyaltyData.lastUpdated).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rewards Redemption Card */}
      <Card data-testid="loyalty-rewards-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-purple-500" />
              <CardTitle className="text-lg">Dostepne nagrody</CardTitle>
            </div>
            {rewardsData?.availableRewards && rewardsData.availableRewards.length > 0 && (
              <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300" data-testid="available-rewards-count">
                {rewardsData.availableRewards.length} {rewardsData.availableRewards.length === 1 ? "dostepna" : "dostepnych"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingRewards ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !rewardsData?.enabled ? (
            <div className="text-center py-8" data-testid="loyalty-not-enabled">
              <Gift className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground text-lg font-medium">Program lojalnosciowy nieaktywny</p>
              <p className="text-muted-foreground text-sm mt-1">
                Aktywuj program w ustawieniach salonu, aby klienci mogli zbierac i wymieniac punkty
              </p>
            </div>
          ) : !rewardsData?.allRewards || rewardsData.allRewards.length === 0 ? (
            <div className="text-center py-8" data-testid="no-rewards-configured">
              <Gift className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground text-lg font-medium">Brak skonfigurowanych nagrod</p>
              <p className="text-muted-foreground text-sm mt-1">
                Dodaj nagrody w ustawieniach programu lojalnosciowego
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="rewards-list">
              {rewardsData.allRewards.map((reward) => {
                const rewardIcon = reward.rewardType === "discount" ? (
                  <Percent className="h-5 w-5 text-purple-500" />
                ) : reward.rewardType === "free_service" ? (
                  <Scissors className="h-5 w-5 text-purple-500" />
                ) : (
                  <ShoppingBag className="h-5 w-5 text-purple-500" />
                );

                const rewardTypeLabel = reward.rewardType === "discount"
                  ? `Rabat ${reward.rewardValue}%`
                  : reward.rewardType === "free_service"
                    ? `Darmowa usluga do ${reward.rewardValue} PLN`
                    : `Produkt gratis do ${reward.rewardValue} PLN`;

                return (
                  <div
                    key={reward.id}
                    className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                      reward.canRedeem
                        ? "border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                        : "border-border opacity-60"
                    }`}
                    data-testid={`reward-item-${reward.id}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-full ${reward.canRedeem ? "bg-purple-100 dark:bg-purple-950/40" : "bg-muted"}`}>
                        {rewardIcon}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate" data-testid={`reward-name-${reward.id}`}>
                          {reward.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {reward.pointsRequired} pkt &middot; {rewardTypeLabel}
                        </p>
                        {reward.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {reward.description}
                          </p>
                        )}
                        {!reward.canRedeem && reward.pointsNeeded > 0 && (
                          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1" data-testid={`reward-points-needed-${reward.id}`}>
                            Brakuje {reward.pointsNeeded} pkt
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant={reward.canRedeem ? "default" : "outline"}
                      size="sm"
                      disabled={!reward.canRedeem}
                      onClick={() => openRedeemDialog(reward)}
                      data-testid={`redeem-btn-${reward.id}`}
                    >
                      <Gift className="h-4 w-4 mr-1" />
                      {reward.canRedeem ? "Wymien" : "Niedostepna"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Redeem Confirmation Dialog */}
      <AlertDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-purple-500" />
              Potwierdzenie realizacji nagrody
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {selectedReward && (
                  <div className="space-y-3 mt-2">
                    <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
                      <p className="font-semibold text-foreground">{selectedReward.name}</p>
                      <p className="text-sm mt-1">
                        {selectedReward.rewardType === "discount"
                          ? `Rabat ${selectedReward.rewardValue}%`
                          : selectedReward.rewardType === "free_service"
                            ? `Darmowa usluga do ${selectedReward.rewardValue} PLN`
                            : `Produkt gratis do ${selectedReward.rewardValue} PLN`}
                      </p>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span>Koszt:</span>
                      <span className="font-bold text-red-600 dark:text-red-400">
                        -{selectedReward.pointsRequired} pkt
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span>Aktualne saldo:</span>
                      <span className="font-medium">{loyaltyData?.points ?? 0} pkt</span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-t pt-2">
                      <span>Saldo po realizacji:</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        {(loyaltyData?.points ?? 0) - selectedReward.pointsRequired} pkt
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={redeemingReward} data-testid="cancel-redeem-btn">
              Anuluj
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRedeemReward}
              disabled={redeemingReward}
              className="bg-purple-600 hover:bg-purple-700"
              data-testid="confirm-redeem-btn"
            >
              <Gift className="h-4 w-4 mr-1" />
              {redeemingReward ? "Realizacja..." : "Potwierdz realizacje"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transactions History Card */}
      <Card data-testid="loyalty-transactions-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Historia transakcji</CardTitle>
            </div>
            {loyaltyData?.transactions && loyaltyData.transactions.length > 0 && (
              <Badge variant="secondary" data-testid="loyalty-transaction-count">
                {loyaltyData.transactions.length} {loyaltyData.transactions.length === 1 ? "transakcja" : loyaltyData.transactions.length >= 2 && loyaltyData.transactions.length <= 4 ? "transakcje" : "transakcji"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingLoyalty ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !loyaltyData?.transactions || loyaltyData.transactions.length === 0 ? (
            <div className="text-center py-12" data-testid="no-loyalty-transactions">
              <Award className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-muted-foreground text-lg font-medium">Brak transakcji lojalnosciowych</p>
              <p className="text-muted-foreground text-sm mt-1">
                Punkty zostan naliczone po zakonczeniu wizyty
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="loyalty-transactions-list">
              {loyaltyData.transactions.map((transaction) => {
                const isPositive = transaction.pointsChange > 0;
                return (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    data-testid={`loyalty-transaction-${transaction.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${isPositive ? "bg-green-100 dark:bg-green-950/40" : "bg-red-100 dark:bg-red-950/40"}`}>
                        {isPositive ? (
                          <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium" data-testid={`transaction-reason-${transaction.id}`}>
                          {transaction.reason || (isPositive ? "Naliczenie punktow" : "Wykorzystanie punktow")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(transaction.createdAt).toLocaleDateString("pl-PL", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-lg font-bold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                      data-testid={`transaction-points-${transaction.id}`}
                    >
                      {isPositive ? "+" : ""}{transaction.pointsChange}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
