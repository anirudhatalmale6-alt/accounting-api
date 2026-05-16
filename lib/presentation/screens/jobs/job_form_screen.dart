import 'package:flutter/material.dart';

import '../../../data/services/job_service.dart';
import '../../../data/services/engineer_service.dart';
import '../../../data/services/master_data_service.dart';

class JobFormScreen extends StatefulWidget {
  final Map? job;
  final DateTime? initialDate;

  const JobFormScreen({
    super.key,
    this.job,
    this.initialDate,
  });

  @override
  State<JobFormScreen> createState() => _JobFormScreenState();
}

class _JobFormScreenState extends State<JobFormScreen> {
  final JobService _jobService = JobService();
  final EngineerService _engineerService = EngineerService();
  final MasterDataService _masterDataService = MasterDataService();

  final _title = TextEditingController();
  final _description = TextEditingController();
  final _jobType = TextEditingController();
  final _address = TextEditingController();
  final _notes = TextEditingController();

  List<dynamic> customers = [];
  List<dynamic> engineers = [];

  Map? selectedCustomer;
  Map? selectedEngineer;

  DateTime startTime = DateTime.now();
  DateTime endTime = DateTime.now().add(const Duration(hours: 1));

  String status = "scheduled";
  String recurrence = "none";

  bool saving = false;
  bool loading = true;

  // Reminder fields
  DateTime? reminderAt;
  bool remindEngineer = true;
  bool remindCustomer = false;

  bool get isEdit => widget.job != null;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    customers = await _masterDataService.getCustomers();
    engineers = await _engineerService.getEngineers();

    if (widget.job != null) {
      final j = widget.job!;

      _title.text = j["title"] ?? "";
      _description.text = j["description"] ?? "";
      _jobType.text = j["job_type"] ?? "";
      _address.text = j["address"] ?? "";
      _notes.text = j["notes"] ?? "";

      status = j["status"] ?? "scheduled";
      recurrence = j["recurrence"] ?? "none";

      startTime = DateTime.parse(j["start_time"]);

      endTime = j["end_time"] != null
          ? DateTime.parse(j["end_time"])
          : startTime.add(const Duration(hours: 1));

      if (j["customer_id"] != null) {
        selectedCustomer = customers.cast<Map>().firstWhere(
              (c) => c["id"] == j["customer_id"],
              orElse: () => {},
            );
        if (selectedCustomer!.isEmpty) selectedCustomer = null;
      }

      if (j["engineer_id"] != null) {
        selectedEngineer = engineers.cast<Map>().firstWhere(
              (e) => e["id"] == j["engineer_id"],
              orElse: () => {},
            );
        if (selectedEngineer!.isEmpty) selectedEngineer = null;
      }

      // Load reminder fields
      if (j["reminder_at"] != null) {
        reminderAt = DateTime.parse(j["reminder_at"]);
      }
      remindEngineer = j["remind_engineer"] ?? true;
      remindCustomer = j["remind_customer"] ?? false;
    } else if (widget.initialDate != null) {
      final d = widget.initialDate!;
      startTime = DateTime(d.year, d.month, d.day, 9);
      endTime = startTime.add(const Duration(hours: 1));

      // Smart default: remind 24 hours before
      reminderAt = startTime.subtract(const Duration(hours: 24));
    }

    if (mounted) setState(() => loading = false);
  }

  Future<void> _pickStart() async {
    final date = await showDatePicker(
      context: context,
      initialDate: startTime,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );

    if (date == null) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(startTime),
    );

    if (time == null) return;

    setState(() {
      startTime = DateTime(date.year, date.month, date.day, time.hour, time.minute);
      endTime = startTime.add(const Duration(hours: 1));
    });
  }

  Future<void> pickReminder() async {
    final initial = reminderAt ?? startTime.subtract(const Duration(hours: 24));

    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime(2035),
    );

    if (date == null) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );

    if (time == null) return;

    setState(() {
      reminderAt = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Job title is required")),
      );
      return;
    }

    setState(() => saving = true);

    final data = {
      "customerId": selectedCustomer?["id"],
      "engineerId": selectedEngineer?["id"],
      "title": _title.text.trim(),
      "description": _description.text.trim(),
      "jobType": _jobType.text.trim(),
      "status": status,
      "startTime": startTime.toIso8601String(),
      "endTime": endTime.toIso8601String(),
      "address": _address.text.trim(),
      "notes": _notes.text.trim(),
      "recurrence": recurrence,
      "reminderAt": reminderAt?.toIso8601String(),
      "remindEngineer": remindEngineer,
      "remindCustomer": remindCustomer,
    };

    try {
      if (isEdit) {
        await _jobService.updateJob(widget.job!["id"], data);
      } else {
        await _jobService.createJob(data);
      }

      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error: $e")),
        );
      }
    }

    setState(() => saving = false);
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Scaffold(
        appBar: AppBar(title: Text(isEdit ? "Edit Job" : "New Job")),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(isEdit ? "Edit Job" : "New Job"),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _title,
              decoration: const InputDecoration(
                labelText: "Job Title *",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _description,
              decoration: const InputDecoration(
                labelText: "Description",
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _jobType,
              decoration: const InputDecoration(
                labelText: "Job Type",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),

            // Customer dropdown
            DropdownButtonFormField<int>(
              value: selectedCustomer?["id"],
              decoration: const InputDecoration(
                labelText: "Customer",
                border: OutlineInputBorder(),
              ),
              items: customers.map<DropdownMenuItem<int>>((c) {
                return DropdownMenuItem<int>(
                  value: c["id"],
                  child: Text(c["name"] ?? ""),
                );
              }).toList(),
              onChanged: (val) {
                setState(() {
                  selectedCustomer = customers
                      .cast<Map>()
                      .firstWhere((c) => c["id"] == val, orElse: () => {});
                  if (selectedCustomer!.isEmpty) selectedCustomer = null;
                });
              },
            ),
            const SizedBox(height: 12),

            // Engineer dropdown
            DropdownButtonFormField<int>(
              value: selectedEngineer?["id"],
              decoration: const InputDecoration(
                labelText: "Engineer",
                border: OutlineInputBorder(),
              ),
              items: engineers.map<DropdownMenuItem<int>>((e) {
                return DropdownMenuItem<int>(
                  value: e["id"],
                  child: Text(e["name"] ?? ""),
                );
              }).toList(),
              onChanged: (val) {
                setState(() {
                  selectedEngineer = engineers
                      .cast<Map>()
                      .firstWhere((e) => e["id"] == val, orElse: () => {});
                  if (selectedEngineer!.isEmpty) selectedEngineer = null;
                });
              },
            ),
            const SizedBox(height: 12),

            // Start time
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.access_time),
              title: const Text("Start Time"),
              subtitle: Text(
                "${startTime.day}/${startTime.month}/${startTime.year} "
                "${startTime.hour.toString().padLeft(2, '0')}:"
                "${startTime.minute.toString().padLeft(2, '0')}",
              ),
              trailing: const Icon(Icons.edit),
              onTap: _pickStart,
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _address,
              decoration: const InputDecoration(
                labelText: "Address",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _notes,
              decoration: const InputDecoration(
                labelText: "Notes",
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 12),

            // Status dropdown
            DropdownButtonFormField<String>(
              value: status,
              decoration: const InputDecoration(
                labelText: "Status",
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: "scheduled", child: Text("Scheduled")),
                DropdownMenuItem(value: "confirmed", child: Text("Confirmed")),
                DropdownMenuItem(value: "on_the_way", child: Text("On the Way")),
                DropdownMenuItem(value: "arrived", child: Text("Arrived")),
                DropdownMenuItem(value: "in_progress", child: Text("In Progress")),
                DropdownMenuItem(value: "completed", child: Text("Completed")),
                DropdownMenuItem(value: "cancelled", child: Text("Cancelled")),
              ],
              onChanged: (val) => setState(() => status = val!),
            ),
            const SizedBox(height: 12),

            // Recurrence dropdown
            DropdownButtonFormField<String>(
              value: recurrence,
              decoration: const InputDecoration(
                labelText: "Recurrence",
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: "none", child: Text("None")),
                DropdownMenuItem(value: "weekly", child: Text("Weekly")),
                DropdownMenuItem(value: "monthly", child: Text("Monthly")),
                DropdownMenuItem(value: "yearly", child: Text("Yearly")),
              ],
              onChanged: (val) => setState(() => recurrence = val!),
            ),

            // Reminder section
            const SizedBox(height: 16),

            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      "Reminder",
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),

                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.notifications_active),
                      title: const Text("Reminder date/time"),
                      subtitle: Text(
                        reminderAt == null
                            ? "No reminder set"
                            : "${reminderAt!.day}/${reminderAt!.month}/${reminderAt!.year} "
                              "${reminderAt!.hour.toString().padLeft(2, '0')}:"
                              "${reminderAt!.minute.toString().padLeft(2, '0')}",
                      ),
                      trailing: const Icon(Icons.edit),
                      onTap: pickReminder,
                    ),

                    SwitchListTile(
                      value: remindEngineer,
                      onChanged: (v) => setState(() => remindEngineer = v),
                      title: const Text("Remind engineer"),
                    ),

                    SwitchListTile(
                      value: remindCustomer,
                      onChanged: (v) => setState(() => remindCustomer = v),
                      title: const Text("Remind customer"),
                      subtitle: const Text("Sends email/SMS if customer contact details exist"),
                    ),

                    if (reminderAt != null)
                      TextButton.icon(
                        onPressed: () => setState(() => reminderAt = null),
                        icon: const Icon(Icons.clear),
                        label: const Text("Clear reminder"),
                      ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            ElevatedButton(
              onPressed: saving ? null : _save,
              child: saving
                  ? const CircularProgressIndicator()
                  : Text(isEdit ? "Update Job" : "Create Job"),
            ),
          ],
        ),
      ),
    );
  }
}
