"use client";

import { Suspense } from "react";

import { useSubscriptionData } from "./_hooks/use-subscription-data";
import { ActivationToast } from "./_components/activation-toast";
import { SubscriptionHeader } from "./_components/subscription-header";
import { LoadingSkeleton } from "./_components/loading-skeleton";
import { ErrorState } from "./_components/error-state";
import { NoSubscription } from "./_components/no-subscription";
import { CurrentPlanCard } from "./_components/current-plan-card";
import { PaymentHistoryCard } from "./_components/payment-history-card";
import { ExpirationWarningCard } from "./_components/expiration-warning-card";
import { RenewalCard } from "./_components/renewal-card";
import { TechnicalInfoCard } from "./_components/technical-info-card";

export default function SubscriptionPage() {
  const {
    subscription,
    plan,
    allPlans,
    scheduledPlan,
    loading,
    error,
    expirationData,
    cancelLoading,
    changePlanLoading,
    downgradeLoading,
    cancelDowngradeLoading,
    renewLoading,
    simulateLoading,
    sendWarningLoading,
    fetchSubscription,
    handleCancel,
    handleChangePlan,
    handleDowngrade,
    handleCancelDowngrade,
    handleSimulateNearExpiry,
    handleSendWarning,
    handleSimulateRenewal,
    setLoading,
  } = useSubscriptionData();

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Activation toast handler */}
      <Suspense fallback={null}>
        <ActivationToast />
      </Suspense>

      {/* Header */}
      <SubscriptionHeader />

      {/* Loading State */}
      {loading && <LoadingSkeleton />}

      {/* Error State */}
      {!loading && error && (
        <ErrorState
          error={error}
          onRetry={() => {
            setLoading(true);
            fetchSubscription();
          }}
        />
      )}

      {/* No Subscription */}
      {!loading && !error && !subscription && <NoSubscription />}

      {/* Active Subscription */}
      {!loading && !error && subscription && plan && (
        <div className="space-y-6">
          <CurrentPlanCard
            subscription={subscription}
            plan={plan}
            allPlans={allPlans}
            scheduledPlan={scheduledPlan}
            changePlanLoading={changePlanLoading}
            downgradeLoading={downgradeLoading}
            cancelLoading={cancelLoading}
            cancelDowngradeLoading={cancelDowngradeLoading}
            onChangePlan={handleChangePlan}
            onDowngrade={handleDowngrade}
            onCancel={handleCancel}
            onCancelDowngrade={handleCancelDowngrade}
            onRefresh={() => {
              setLoading(true);
              fetchSubscription();
            }}
          />

          <PaymentHistoryCard />

          {/* Expiration Warning Card */}
          {(subscription.status === "active" ||
            subscription.status === "trialing") &&
            expirationData && (
              <ExpirationWarningCard
                subscription={subscription}
                expirationData={expirationData}
                renewLoading={renewLoading}
                simulateLoading={simulateLoading}
                sendWarningLoading={sendWarningLoading}
                onSimulateRenewal={handleSimulateRenewal}
                onSimulateNearExpiry={handleSimulateNearExpiry}
                onSendWarning={handleSendWarning}
              />
            )}

          {/* Automatic Renewal Card */}
          {subscription.status === "active" && (
            <RenewalCard
              subscription={subscription}
              plan={plan}
              scheduledPlan={scheduledPlan}
              renewLoading={renewLoading}
              onSimulateRenewal={handleSimulateRenewal}
            />
          )}

          {/* Technical Info */}
          <TechnicalInfoCard subscription={subscription} />
        </div>
      )}
    </div>
  );
}
