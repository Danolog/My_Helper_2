"use client"

import { StepAccountDetails } from "./_components/StepAccountDetails"
import { StepConfirmation } from "./_components/StepConfirmation"
import { StepPlanSelection } from "./_components/StepPlanSelection"
import { useRegistration } from "./_hooks/use-registration"

interface RegistrationFlowProps {
  preselectedPlan: string | null
}

export function RegistrationFlow({ preselectedPlan }: RegistrationFlowProps) {
  const {
    step,
    selectedPlan,
    selectedPlanData,
    plansLoading,
    basicPlan,
    proPlan,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    setError,
    fieldErrors,
    isPending,
    showVerificationMessage,
    wasRecovered,
    clearSavedForm,
    handleSelectPlan,
    handleContinueToAccount,
    handleBackToPlanSelection,
    clearFieldError,
    handleSubmit,
    handleRestoreForm,
    router,
  } = useRegistration(preselectedPlan)

  // Verification message after successful signup
  if (showVerificationMessage) {
    return (
      <StepConfirmation
        email={email}
        selectedPlan={selectedPlan}
        selectedPlanData={selectedPlanData}
        onNavigateToDashboard={() => {
          router.replace("/dashboard")
          router.refresh()
        }}
        onSetError={setError}
      />
    )
  }

  // Step 1: Plan Selection
  if (step === 1) {
    return (
      <StepPlanSelection
        selectedPlan={selectedPlan}
        plansLoading={plansLoading}
        basicPlan={basicPlan}
        proPlan={proPlan}
        onSelectPlan={handleSelectPlan}
        onContinue={handleContinueToAccount}
      />
    )
  }

  // Step 2: Account Details
  return (
    <StepAccountDetails
      selectedPlan={selectedPlan}
      selectedPlanData={selectedPlanData}
      name={name}
      email={email}
      password={password}
      confirmPassword={confirmPassword}
      error={error}
      fieldErrors={fieldErrors}
      isPending={isPending}
      wasRecovered={wasRecovered}
      onNameChange={setName}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onConfirmPasswordChange={setConfirmPassword}
      onClearFieldError={clearFieldError}
      onBack={handleBackToPlanSelection}
      onSubmit={handleSubmit}
      onRestore={handleRestoreForm}
      onDismissRecovery={clearSavedForm}
    />
  )
}
