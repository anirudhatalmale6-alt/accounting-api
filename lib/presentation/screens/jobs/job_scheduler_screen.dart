import 'package:flutter/material.dart';
import 'package:syncfusion_flutter_calendar/calendar.dart';

import '../../../data/services/job_service.dart';

class JobSchedulerScreen extends StatefulWidget {
  const JobSchedulerScreen({super.key});

  @override
  State<JobSchedulerScreen> createState() =>
      _JobSchedulerScreenState();
}

class _JobSchedulerScreenState
    extends State<JobSchedulerScreen> {
  final JobService _svc = JobService();

  bool loading = true;

  List<dynamic> jobs = [];

  @override
  void initState() {
    super.initState();

    load();
  }

  Future<void> load() async {
    setState(() => loading = true);

    final now = DateTime.now();

    final from = DateTime(
      now.year,
      now.month,
      1,
    ).toIso8601String();

    final to = DateTime(
      now.year,
      now.month + 1,
      0,
      23,
      59,
    ).toIso8601String();

    jobs = await _svc.getJobs(
      dateFrom: from,
      dateTo: to,
    );

    if (mounted) {
      setState(() => loading = false);
    }
  }

  Future<void> onDragEnd(
    AppointmentDragEndDetails details,
  ) async {
    final appointment =
        details.appointment as Appointment;

    final newStart = details.droppingTime;

    if (newStart == null) return;

    final duration = appointment.endTime
        .difference(appointment.startTime);

    final newEnd = newStart.add(duration);

    await _svc.rescheduleJob(
      id: appointment.id as int,
      startTime: newStart,
      endTime: newEnd,
    );

    await load();
  }

  Color parseColour(String hex) {
    final clean = hex.replaceAll("#", "");

    return Color(
      int.parse("FF$clean", radix: 16),
    );
  }

  @override
  Widget build(BuildContext context) {
    final appointments = jobs.map((j) {
      final start =
          DateTime.parse(j["start_time"]);

      final end = j["end_time"] != null
          ? DateTime.parse(j["end_time"])
          : start.add(const Duration(hours: 1));

      return Appointment(
        id: j["id"],
        startTime: start,
        endTime: end,
        subject: j["title"] ?? "Job",
        notes: j["customer_name"] ?? "",
        color: parseColour(
          j["engineer_colour"] ?? "#2563EB",
        ),
      );
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text("Job Scheduler"),
        actions: [
          IconButton(
            onPressed: load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: loading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : SfCalendar(
              view: CalendarView.week,
              allowDragAndDrop: true,
              dataSource:
                  JobCalendarDataSource(
                appointments,
              ),
              onDragEnd: onDragEnd,
              timeSlotViewSettings:
                  const TimeSlotViewSettings(
                startHour: 7,
                endHour: 20,
                timeIntervalHeight: 70,
              ),
            ),
    );
  }
}

class JobCalendarDataSource
    extends CalendarDataSource {
  JobCalendarDataSource(
    List<Appointment> appointments,
  ) {
    this.appointments = appointments;
  }
}
