import 'package:flutter/material.dart';

import '../../../data/services/api_client.dart';

class TeamService {
  Future<List<dynamic>> getTeamMembers() async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/team");
    return res.data["members"] ?? [];
  }

  Future<void> inviteMember({
    required int userId,
    required String role,
  }) async {
    final api = await ApiClient.create();
    await api.dio.post("/team/invite", data: {
      "userId": userId,
      "role": role,
    });
  }

  Future<void> updateMember({
    required int id,
    required String role,
    required bool isActive,
  }) async {
    final api = await ApiClient.create();
    await api.dio.put("/team/$id", data: {
      "role": role,
      "isActive": isActive,
    });
  }
}

class TeamManagementScreen extends StatefulWidget {
  const TeamManagementScreen({super.key});

  @override
  State<TeamManagementScreen> createState() =>
      _TeamManagementScreenState();
}

class _TeamManagementScreenState extends State<TeamManagementScreen> {
  final TeamService _svc = TeamService();

  bool loading = true;
  List<dynamic> members = [];

  final roles = ["owner", "admin", "engineer", "accountant"];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      members = await _svc.getTeamMembers();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error: $e")),
        );
      }
    }
    if (mounted) setState(() => loading = false);
  }

  Color roleColor(String role) {
    switch (role) {
      case "owner":
        return Colors.purple;
      case "admin":
        return Colors.blue;
      case "engineer":
        return Colors.green;
      case "accountant":
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  IconData roleIcon(String role) {
    switch (role) {
      case "owner":
        return Icons.star;
      case "admin":
        return Icons.admin_panel_settings;
      case "engineer":
        return Icons.engineering;
      case "accountant":
        return Icons.calculate;
      default:
        return Icons.person;
    }
  }

  Future<void> _showInviteDialog() async {
    final userIdCtrl = TextEditingController();
    String selectedRole = "engineer";

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: const Text("Invite Team Member"),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: userIdCtrl,
                    decoration: const InputDecoration(
                      labelText: "User ID *",
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: selectedRole,
                    decoration: const InputDecoration(
                      labelText: "Role",
                      border: OutlineInputBorder(),
                    ),
                    items: roles.map((r) {
                      return DropdownMenuItem(
                        value: r,
                        child: Text(r[0].toUpperCase() + r.substring(1)),
                      );
                    }).toList(),
                    onChanged: (v) {
                      setDialogState(() => selectedRole = v!);
                    },
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text("Cancel"),
                ),
                ElevatedButton(
                  onPressed: () async {
                    if (userIdCtrl.text.trim().isEmpty) return;
                    try {
                      await _svc.inviteMember(
                        userId: int.parse(userIdCtrl.text.trim()),
                        role: selectedRole,
                      );
                      Navigator.pop(ctx, true);
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text("Error: $e")),
                      );
                    }
                  },
                  child: const Text("Invite"),
                ),
              ],
            );
          },
        );
      },
    );

    if (result == true) await load();
  }

  Future<void> _editMember(Map member) async {
    String role = member["role"] ?? "engineer";
    bool isActive = member["is_active"] ?? true;

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: const Text("Edit Member"),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    value: role,
                    decoration: const InputDecoration(
                      labelText: "Role",
                      border: OutlineInputBorder(),
                    ),
                    items: roles.map((r) {
                      return DropdownMenuItem(
                        value: r,
                        child: Text(r[0].toUpperCase() + r.substring(1)),
                      );
                    }).toList(),
                    onChanged: (v) {
                      setDialogState(() => role = v!);
                    },
                  ),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text("Active"),
                    value: isActive,
                    onChanged: (v) {
                      setDialogState(() => isActive = v);
                    },
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text("Cancel"),
                ),
                ElevatedButton(
                  onPressed: () async {
                    try {
                      await _svc.updateMember(
                        id: member["id"],
                        role: role,
                        isActive: isActive,
                      );
                      Navigator.pop(ctx, true);
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text("Error: $e")),
                      );
                    }
                  },
                  child: const Text("Save"),
                ),
              ],
            );
          },
        );
      },
    );

    if (result == true) await load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Team"),
        actions: [
          IconButton(
            onPressed: load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showInviteDialog,
        child: const Icon(Icons.person_add),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : members.isEmpty
              ? const Center(child: Text("No team members yet"))
              : ListView.builder(
                  itemCount: members.length,
                  itemBuilder: (_, i) {
                    final m = members[i];
                    final role = m["role"] ?? "engineer";
                    final active = m["is_active"] ?? true;

                    return Card(
                      margin: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: roleColor(role),
                          child: Icon(
                            roleIcon(role),
                            color: Colors.white,
                          ),
                        ),
                        title: Text("User #${m["user_id"]}"),
                        subtitle: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: roleColor(role).withOpacity(0.12),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                role.toUpperCase(),
                                style: TextStyle(
                                  color: roleColor(role),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            if (!active)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.red.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Text(
                                  "INACTIVE",
                                  style: TextStyle(
                                    color: Colors.red,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.edit),
                          onPressed: () => _editMember(m),
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
