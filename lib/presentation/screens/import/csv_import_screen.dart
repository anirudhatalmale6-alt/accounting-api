import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

import '../../../data/services/api_client.dart';

class CsvImportScreen extends StatefulWidget {
  final String type; // "customers" or "suppliers"

  const CsvImportScreen({super.key, required this.type});

  @override
  State<CsvImportScreen> createState() => _CsvImportScreenState();
}

class _CsvImportScreenState extends State<CsvImportScreen> {
  List<Map<String, String>> parsedRows = [];
  List<String> headers = [];
  bool importing = false;
  Map<String, dynamic>? result;
  String? error;

  final expectedColumns = [
    "name",
    "email",
    "phone",
    "address",
    "vat_number",
    "contact_person",
  ];

  Future<void> _pickFile() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ["csv", "txt"],
      withData: true,
    );

    if (picked == null || picked.files.isEmpty) return;

    final bytes = picked.files.first.bytes;
    if (bytes == null) {
      setState(() => error = "Could not read file");
      return;
    }

    try {
      final content = utf8.decode(bytes);
      final lines = const LineSplitter().convert(content);

      if (lines.isEmpty) {
        setState(() => error = "File is empty");
        return;
      }

      // Parse header
      headers = _parseCsvLine(lines[0])
          .map((h) => h.trim().toLowerCase().replaceAll(" ", "_"))
          .toList();

      if (!headers.contains("name")) {
        setState(() =>
            error = "CSV must have a 'name' column. Found: ${headers.join(', ')}");
        return;
      }

      // Parse rows
      parsedRows = [];
      for (int i = 1; i < lines.length; i++) {
        final line = lines[i].trim();
        if (line.isEmpty) continue;

        final values = _parseCsvLine(line);
        final row = <String, String>{};
        for (int j = 0; j < headers.length && j < values.length; j++) {
          row[headers[j]] = values[j].trim();
        }
        if ((row["name"] ?? "").isNotEmpty) {
          parsedRows.add(row);
        }
      }

      setState(() {
        error = null;
        result = null;
      });
    } catch (e) {
      setState(() => error = "Failed to parse CSV: $e");
    }
  }

  List<String> _parseCsvLine(String line) {
    final result = <String>[];
    bool inQuotes = false;
    StringBuffer current = StringBuffer();

    for (int i = 0; i < line.length; i++) {
      final ch = line[i];
      if (ch == '"') {
        inQuotes = !inQuotes;
      } else if (ch == ',' && !inQuotes) {
        result.add(current.toString());
        current = StringBuffer();
      } else {
        current.write(ch);
      }
    }
    result.add(current.toString());
    return result;
  }

  Future<void> _import() async {
    if (parsedRows.isEmpty) return;

    setState(() {
      importing = true;
      error = null;
    });

    try {
      final api = await ApiClient.create();
      final res = await api.dio.post(
        "/${widget.type}/import",
        data: {"rows": parsedRows},
      );
      setState(() => result = res.data);
    } catch (e) {
      setState(() => error = "Import failed: $e");
    }

    setState(() => importing = false);
  }

  @override
  Widget build(BuildContext context) {
    final label = widget.type == "customers" ? "Customers" : "Suppliers";

    return Scaffold(
      appBar: AppBar(
        title: Text("Import $label"),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Import $label from CSV",
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      "Your CSV file should have these columns:",
                      style: TextStyle(color: Colors.grey),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      "name (required), email, phone, address, vat_number, contact_person",
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      "The first row should be the column headers.",
                      style: TextStyle(color: Colors.grey, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            ElevatedButton.icon(
              onPressed: importing ? null : _pickFile,
              icon: const Icon(Icons.upload_file),
              label: const Text("Select CSV File"),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
            const SizedBox(height: 16),

            if (error != null)
              Card(
                color: Colors.red.shade50,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      const Icon(Icons.error, color: Colors.red),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          error!,
                          style: const TextStyle(color: Colors.red),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            if (result != null)
              Card(
                color: Colors.green.shade50,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.check_circle, color: Colors.green),
                          const SizedBox(width: 8),
                          const Text(
                            "Import Complete",
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                              color: Colors.green,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text("Imported: ${result!["imported"]}"),
                      Text("Skipped: ${result!["skipped"]}"),
                      Text("Total rows: ${result!["total"]}"),
                      if (result!["errors"] != null &&
                          (result!["errors"] as List).isNotEmpty) ...[
                        const SizedBox(height: 8),
                        const Text(
                          "Errors:",
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        ...(result!["errors"] as List).map((e) => Text(
                              "Row ${e["row"]}: ${e["error"]}",
                              style: const TextStyle(
                                  fontSize: 12, color: Colors.red),
                            )),
                      ],
                    ],
                  ),
                ),
              ),

            if (parsedRows.isNotEmpty && result == null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Preview (${parsedRows.length} rows)",
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      const Divider(),
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: DataTable(
                          columns: headers
                              .map((h) => DataColumn(label: Text(h)))
                              .toList(),
                          rows: parsedRows
                              .take(10)
                              .map((row) => DataRow(
                                    cells: headers
                                        .map((h) =>
                                            DataCell(Text(row[h] ?? "")))
                                        .toList(),
                                  ))
                              .toList(),
                        ),
                      ),
                      if (parsedRows.length > 10)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            "... and ${parsedRows.length - 10} more rows",
                            style: const TextStyle(
                                color: Colors.grey, fontSize: 13),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              ElevatedButton.icon(
                onPressed: importing ? null : _import,
                icon: importing
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.cloud_upload),
                label: Text(
                  importing
                      ? "Importing..."
                      : "Import ${parsedRows.length} $label",
                ),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
