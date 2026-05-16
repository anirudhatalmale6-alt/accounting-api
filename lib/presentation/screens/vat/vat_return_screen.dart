import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../data/services/vat_service.dart';

class VatReturnScreen extends StatefulWidget {
  const VatReturnScreen({super.key});

  @override
  State<VatReturnScreen> createState() => _VatReturnScreenState();
}

class _VatReturnScreenState extends State<VatReturnScreen> {
  final VatService _vatService = VatService();
  final _currencyFmt = NumberFormat.currency(symbol: "£", decimalDigits: 2);

  DateTime dateFrom = DateTime(DateTime.now().year, DateTime.now().month - 3, 1);
  DateTime dateTo = DateTime(DateTime.now().year, DateTime.now().month, 0);

  bool loading = false;
  Map<String, dynamic>? vatReturn;
  String? error;

  Future<void> _pickDateRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      initialDateRange: DateTimeRange(start: dateFrom, end: dateTo),
    );

    if (picked != null) {
      setState(() {
        dateFrom = picked.start;
        dateTo = picked.end;
      });
      _fetchReturn();
    }
  }

  Future<void> _fetchReturn() async {
    setState(() {
      loading = true;
      error = null;
    });

    try {
      vatReturn = await _vatService.getVatReturn(
        dateFrom: DateFormat("yyyy-MM-dd").format(dateFrom),
        dateTo: DateFormat("yyyy-MM-dd").format(dateTo),
      );
    } catch (e) {
      error = e.toString();
    }

    if (mounted) setState(() => loading = false);
  }

  void _goToDeclaration() {
    if (vatReturn == null) return;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => VatDeclarationScreen(
          vatReturn: vatReturn!,
          dateFrom: dateFrom,
          dateTo: dateTo,
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _fetchReturn();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("VAT Return"),
        actions: [
          IconButton(
            onPressed: _pickDateRange,
            icon: const Icon(Icons.date_range),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline, size: 48, color: Colors.red),
                      const SizedBox(height: 12),
                      Text("Error: $error"),
                      const SizedBox(height: 12),
                      ElevatedButton(
                        onPressed: _fetchReturn,
                        child: const Text("Retry"),
                      ),
                    ],
                  ),
                )
              : vatReturn == null
                  ? const Center(child: Text("Select a date range"))
                  : _buildReturnView(),
    );
  }

  Widget _buildReturnView() {
    final boxes = vatReturn!["boxes"] ?? {};
    final period = vatReturn!["period"] ?? {};

    return SingleChildScrollView(
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
                  const Text(
                    "VAT Period",
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "${DateFormat("dd/MM/yyyy").format(dateFrom)} - "
                    "${DateFormat("dd/MM/yyyy").format(dateTo)}",
                    style: const TextStyle(fontSize: 15),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    "VAT Return Figures",
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const Divider(),
                  _boxRow("Box 1", "VAT due on sales", boxes["box1"]),
                  _boxRow("Box 2", "VAT due on acquisitions", boxes["box2"]),
                  _boxRow("Box 3", "Total VAT due (Box 1 + 2)", boxes["box3"]),
                  const Divider(),
                  _boxRow("Box 4", "VAT reclaimed on purchases", boxes["box4"]),
                  _boxRow("Box 5", "Net VAT to pay/reclaim", boxes["box5"],
                      highlight: true),
                  const Divider(),
                  _boxRow("Box 6", "Total sales excl. VAT", boxes["box6"]),
                  _boxRow("Box 7", "Total purchases excl. VAT", boxes["box7"]),
                  _boxRow("Box 8", "Total supplies excl. VAT (EU)", boxes["box8"]),
                  _boxRow("Box 9", "Total acquisitions excl. VAT (EU)", boxes["box9"]),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          ElevatedButton.icon(
            onPressed: _goToDeclaration,
            icon: const Icon(Icons.verified_user),
            label: const Text("Review and Submit"),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              textStyle: const TextStyle(fontSize: 16),
            ),
          ),
        ],
      ),
    );
  }

  Widget _boxRow(String box, String label, dynamic value,
      {bool highlight = false}) {
    final amount = (value is num) ? value.toDouble() : 0.0;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: 50,
            child: Text(
              box,
              style: TextStyle(
                fontWeight: highlight ? FontWeight.bold : FontWeight.w600,
                color: highlight ? Colors.blue : null,
              ),
            ),
          ),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: highlight ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          Text(
            _currencyFmt.format(amount),
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: highlight ? 16 : 14,
              color: highlight
                  ? (amount >= 0 ? Colors.red : Colors.green)
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}

class VatDeclarationScreen extends StatefulWidget {
  final Map<String, dynamic> vatReturn;
  final DateTime dateFrom;
  final DateTime dateTo;

  const VatDeclarationScreen({
    super.key,
    required this.vatReturn,
    required this.dateFrom,
    required this.dateTo,
  });

  @override
  State<VatDeclarationScreen> createState() => _VatDeclarationScreenState();
}

class _VatDeclarationScreenState extends State<VatDeclarationScreen> {
  final VatService _vatService = VatService();
  final _currencyFmt = NumberFormat.currency(symbol: "£", decimalDigits: 2);
  final _vrnController = TextEditingController();

  bool declarationAccepted = false;
  bool submitting = false;

  Future<void> _submit() async {
    if (!declarationAccepted) return;

    final vrn = _vrnController.text.trim();
    if (vrn.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Please enter your VAT Registration Number (VRN)")),
      );
      return;
    }

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Confirm Submission"),
        content: const Text(
          "You are about to submit this VAT return to HMRC. "
          "This action cannot be undone. Are you sure?",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text("Cancel"),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            child: const Text("Submit to HMRC"),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => submitting = true);

    try {
      final boxes = widget.vatReturn["boxes"] ?? {};

      final vatData = {
        "periodKey": DateFormat("yyyyMM").format(widget.dateTo),
        "vatDueSales": boxes["box1"] ?? 0,
        "vatDueAcquisitions": boxes["box2"] ?? 0,
        "totalVatDue": boxes["box3"] ?? 0,
        "vatReclaimedCurrPeriod": boxes["box4"] ?? 0,
        "netVatDue": (boxes["box5"] ?? 0).abs(),
        "totalValueSalesExVAT": (boxes["box6"] ?? 0).round(),
        "totalValuePurchasesExVAT": (boxes["box7"] ?? 0).round(),
        "totalValueGoodsSuppliedExVAT": (boxes["box8"] ?? 0).round(),
        "totalAcquisitionsExVAT": (boxes["box9"] ?? 0).round(),
        "finalised": true,
      };

      await _vatService.submitVatReturn(
        vrn: vrn,
        vatData: vatData,
        deviceHeaders: {},
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("VAT return submitted successfully to HMRC"),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.pop(context, true);
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Submission failed: $e")),
        );
      }
    }

    if (mounted) setState(() => submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final boxes = widget.vatReturn["boxes"] ?? {};
    final netVat = (boxes["box5"] is num) ? boxes["box5"].toDouble() : 0.0;

    return Scaffold(
      appBar: AppBar(
        title: const Text("Review & Declare"),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              color: Colors.blue.shade50,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    const Text(
                      "VAT Period",
                      style: TextStyle(fontSize: 14, color: Colors.grey),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "${DateFormat("dd/MM/yyyy").format(widget.dateFrom)} - "
                      "${DateFormat("dd/MM/yyyy").format(widget.dateTo)}",
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      netVat >= 0 ? "Net VAT to Pay" : "Net VAT to Reclaim",
                      style: const TextStyle(fontSize: 14, color: Colors.grey),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _currencyFmt.format(netVat.abs()),
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: netVat >= 0 ? Colors.red : Colors.green,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      "Summary",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const Divider(),
                    _summaryRow("VAT due on sales (Box 1)", boxes["box1"]),
                    _summaryRow("VAT due on acquisitions (Box 2)", boxes["box2"]),
                    _summaryRow("Total VAT due (Box 3)", boxes["box3"]),
                    _summaryRow("VAT reclaimed (Box 4)", boxes["box4"]),
                    _summaryRow("Net VAT (Box 5)", boxes["box5"]),
                    const Divider(),
                    _summaryRow("Sales excl. VAT (Box 6)", boxes["box6"]),
                    _summaryRow("Purchases excl. VAT (Box 7)", boxes["box7"]),
                    _summaryRow("EU Supplies (Box 8)", boxes["box8"]),
                    _summaryRow("EU Acquisitions (Box 9)", boxes["box9"]),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            TextField(
              controller: _vrnController,
              decoration: const InputDecoration(
                labelText: "VAT Registration Number (VRN) *",
                hintText: "e.g. 123456789",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.numbers),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),

            Card(
              color: Colors.amber.shade50,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.gavel, color: Colors.amber.shade800),
                        const SizedBox(width: 8),
                        Text(
                          "HMRC Declaration",
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                            color: Colors.amber.shade900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      "I declare that the information provided in this "
                      "return is true, complete and accurate to the best "
                      "of my knowledge and belief. I understand that "
                      "submitting false or misleading information may "
                      "lead to penalties and prosecution under UK law.",
                      style: TextStyle(fontSize: 14, height: 1.5),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      "By ticking this box and submitting, you confirm "
                      "you are authorised to make this declaration on "
                      "behalf of the business.",
                      style: TextStyle(
                        fontSize: 13,
                        fontStyle: FontStyle.italic,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 12),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: declarationAccepted,
                      onChanged: (v) {
                        setState(() => declarationAccepted = v ?? false);
                      },
                      title: const Text(
                        "I agree to the above declaration",
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      controlAffinity: ListTileControlAffinity.leading,
                      activeColor: Colors.green,
                    ),
                    if (declarationAccepted)
                      Padding(
                        padding: const EdgeInsets.only(left: 16),
                        child: Text(
                          "Accepted at ${DateFormat("dd/MM/yyyy HH:mm").format(DateTime.now())}",
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.green.shade700,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            ElevatedButton.icon(
              onPressed: declarationAccepted && !submitting ? _submit : null,
              icon: submitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send),
              label: Text(
                submitting ? "Submitting..." : "Submit VAT Return to HMRC",
              ),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                textStyle: const TextStyle(fontSize: 16),
                backgroundColor:
                    declarationAccepted ? Colors.green : Colors.grey,
                foregroundColor: Colors.white,
                disabledBackgroundColor: Colors.grey.shade300,
              ),
            ),
            const SizedBox(height: 8),

            if (!declarationAccepted)
              const Center(
                child: Text(
                  "You must accept the declaration before submitting",
                  style: TextStyle(color: Colors.red, fontSize: 13),
                ),
              ),

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(String label, dynamic value) {
    final amount = (value is num) ? value.toDouble() : 0.0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 13))),
          Text(
            _currencyFmt.format(amount),
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}
