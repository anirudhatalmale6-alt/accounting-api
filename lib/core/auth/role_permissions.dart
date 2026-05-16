class RolePermissions {
  static bool canAccessAccounting(
    String role,
  ) {
    return [
      "owner",
      "admin",
      "accountant",
    ].contains(role);
  }

  static bool canAccessJobs(
    String role,
  ) {
    return [
      "owner",
      "admin",
      "engineer",
    ].contains(role);
  }

  static bool canAccessPayroll(
    String role,
  ) {
    return [
      "owner",
      "admin",
    ].contains(role);
  }

  static bool canManageTeam(
    String role,
  ) {
    return [
      "owner",
      "admin",
    ].contains(role);
  }

  static bool canSubmitVat(
    String role,
  ) {
    return [
      "owner",
      "accountant",
    ].contains(role);
  }
}
