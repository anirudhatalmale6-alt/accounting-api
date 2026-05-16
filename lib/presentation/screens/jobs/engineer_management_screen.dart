import 'package:flutter/material.dart';

import '../../../data/services/engineer_service.dart';

class EngineerManagementScreen extends StatefulWidget {
  const EngineerManagementScreen({super.key});

  @override
  State<EngineerManagementScreen> createState() =>
      _EngineerManagementScreenState();
}

class _EngineerManagementScreenState
    extends State<EngineerManagementScreen> {
  final EngineerService _svc = EngineerService();

  bool loading = true;
  List<dynamic> engineers = [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      engineers = await _svc.getEngineers();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error loading engineers: $e")),
        );
      }
    }
    if (mounted) setState(() => loading = false);
  }

  Color parseColour(String hex) {
    final clean = hex.replaceAll("#", "");
    return Color(int.parse("FF$clean", radix: 16));
  }

  Future<void> _showEngineerDialog({Map? engineer}) async {
    final nameCtrl = TextEditingController(text: engineer?["name"] ?? "");
    final emailCtrl = TextEditingController(text: engineer?["email"] ?? "");
    final phoneCtrl = TextEditingController(text: engineer?["phone"] ?? "");
    String colour = engineer?["colour"] ?? "#2563EB";
    bool isActive = engineer?["is_active"] ?? true;

    final colours = [
      "#2563EB",
      "#DC2626",
      "#16A34A",
      "#9333EA",
      "#EA580C",
      "#0891B2",
      "#CA8A04",
      "#DB2777",
    ];

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: Text(engineer == null ? "Add Engineer" : "Edit Engineer"),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: "Name *",
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: emailCtrl,
                      decoration: const InputDecoration(
                        labelText: "Email",
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phoneCtrl,
                      decoration: const InputDecoration(
                        labelText: "Phone",
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 16),
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        "Colour",
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: colours.map((c) {
                        final isSelected = c == colour;
                        return GestureDetector(
                          onTap: () {
                            setDialogState(() => colour = c);
                          },
                          child: Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: parseColour(c),
                              shape: BoxShape.circle,
                              border: isSelected
                                  ? Border.all(color: Colors.black, width: 3)
                                  : null,
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                    if (engineer != null) ...[
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
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text("Cancel"),
                ),
                ElevatedButton(
                  onPressed: () async {
                    if (nameCtrl.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text("Engineer name is required"),
                        ),
                      );
                      return;
                    }
                    try {
                      if (engineer == null) {
                        await _svc.createEngineer(
                          name: nameCtrl.text.trim(),
                          email: emailCtrl.text.trim().isEmpty
                              ? null
                              : emailCtrl.text.trim(),
                          phone: phoneCtrl.text.trim().isEmpty
                              ? null
                              : phoneCtrl.text.trim(),
                          colour: colour,
                        );
                      } else {
                        await _svc.updateEngineer(
                          id: engineer["id"],
                          name: nameCtrl.text.trim(),
                          email: emailCtrl.text.trim().isEmpty
                              ? null
                              : emailCtrl.text.trim(),
                          phone: phoneCtrl.text.trim().isEmpty
                              ? null
                              : phoneCtrl.text.trim(),
                          colour: colour,
                          isActive: isActive,
                        );
                      }
                      Navigator.pop(ctx, true);
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text("Error: $e")),
                      );
                    }
                  },
                  child: Text(engineer == null ? "Add" : "Save"),
                ),
              ],
            );
          },
        );
      },
    );

    if (result == true) {
      await load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Engineers"),
        actions: [
          IconButton(
            onPressed: load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showEngineerDialog(),
        child: const Icon(Icons.add),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : engineers.isEmpty
              ? const Center(child: Text("No engineers yet"))
              : ListView.builder(
                  itemCount: engineers.length,
                  itemBuilder: (_, i) {
                    final eng = engineers[i];
                    final colour =
                        parseColour(eng["colour"] ?? "#2563EB");

                    return Card(
                      margin: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: colour,
                          child: Text(
                            (eng["name"] ?? "E")
                                .toString()
                                .substring(0, 1)
                                .toUpperCase(),
                            style:
                                const TextStyle(color: Colors.white),
                          ),
                        ),
                        title: Text(eng["name"] ?? ""),
                        subtitle: Text(
                          [
                            if (eng["email"] != null) eng["email"],
                            if (eng["phone"] != null) eng["phone"],
                          ].join(" | "),
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.edit),
                          onPressed: () =>
                              _showEngineerDialog(engineer: eng),
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
