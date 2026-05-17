import 'package:flutter/material.dart';

import '../../../data/services/job_service.dart';

class DispatchLiveBoardScreen extends StatefulWidget {
  const DispatchLiveBoardScreen({super.key});

  @override
  State<DispatchLiveBoardScreen> createState() =>
      _DispatchLiveBoardScreenState();
}

class _DispatchLiveBoardScreenState extends State<DispatchLiveBoardScreen> {
  final JobService _svc = JobService();

  bool loading = true;
  List<dynamic> board = [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);

    try {
      board = await _svc.getDispatchLiveBoard();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Failed to load live board: $e")),
        );
      }
    }

    if (mounted) setState(() => loading = false);
  }

  Color parseColour(String hex) {
    final clean = hex.replaceAll("#", "");
    return Color(int.parse("FF$clean", radix: 16));
  }

  Color statusColor(String status) {
    return status == "busy" ? Colors.orange : Colors.green;
  }

  String formatTime(dynamic value) {
    if (value == null) return "";
    final dt = DateTime.tryParse(value.toString());
    if (dt == null) return "";
    return "${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}";
  }

  Widget jobLine(String label, dynamic job) {
    if (job == null) {
      return Text("$label: None");
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          "$label: ${job["title"] ?? "Job"}",
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        Text(
          "${formatTime(job["start_time"])} • ${job["customer_name"] ?? ""}",
          style: const TextStyle(color: Colors.black54),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final freeCount = board.where((e) => e["status"] == "free").length;
    final busyCount = board.where((e) => e["status"] == "busy").length;

    return Scaffold(
      appBar: AppBar(
        title: const Text("Engineer Live Board"),
        actions: [
          IconButton(
            onPressed: load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Card(
                          child: ListTile(
                            title: const Text("Free"),
                            trailing: Text(
                              "$freeCount",
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: Card(
                          child: ListTile(
                            title: const Text("Busy"),
                            trailing: Text(
                              "$busyCount",
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ...board.map((row) {
                    try {
                      final engineer = row["engineer"] ?? {};
                      final status = row["status"]?.toString() ?? "free";
                      final colourHex = engineer["colour"]?.toString() ?? "#2563EB";
                      final colour = parseColour(colourHex);
                      final name = engineer["name"]?.toString() ?? "Engineer";

                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  CircleAvatar(
                                    backgroundColor: colour,
                                    child: Text(
                                      name.isNotEmpty
                                          ? name.substring(0, 1).toUpperCase()
                                          : "E",
                                      style: const TextStyle(color: Colors.white),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(
                                      name,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 10,
                                      vertical: 4,
                                    ),
                                    decoration: BoxDecoration(
                                      color: statusColor(status).withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text(
                                      status.toUpperCase(),
                                      style: TextStyle(
                                        color: statusColor(status),
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              jobLine("Current", row["currentJob"]),
                              const SizedBox(height: 8),
                              jobLine("Next", row["nextJob"]),
                            ],
                          ),
                        ),
                      );
                    } catch (_) {
                      return const SizedBox.shrink();
                    }
                  }),
                ],
              ),
            ),
    );
  }
}
