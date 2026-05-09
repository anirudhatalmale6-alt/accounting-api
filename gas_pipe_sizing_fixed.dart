import 'package:flutter/material.dart';
import 'dart:math' as math;

class GasPipeSizingPage extends StatefulWidget {
  static const route = '/pipe-sizing';
  const GasPipeSizingPage({Key? key}) : super(key: key);

  @override
  State<GasPipeSizingPage> createState() => _GasPipeSizingPageState();
}

class _GasPipeSizingPageState extends State<GasPipeSizingPage> {
  static const Color _primaryTeal = Color(0xFF3C6E6A); // Gas Man style
  static const int _maxSections = 5;
  static const double _maxPressureDropMbar = 1.0; // BS 6891 NG limit

  final TextEditingController _gasRateController = TextEditingController();

  final List<_PipeSectionControllers> _sections = [
    _PipeSectionControllers(sectionIndex: 1),
  ];

  // BS-style friction factors for copper pipe (approximation of BS 6891 tables)
  // pressureDropPerMetre (mbar/m) = k(d) * Q^1.82, Q in m3/h.
  final Map<int, double> _kCopperByDiameter = const {
    8: 4.14,
    10: 1.12,
    15: 0.126,
    22: 0.0187,
    28: 0.00561,
    35: 0.00095,
  };

  final List<int> _allowedDiameters = const [8, 10, 15, 22, 28, 35];

  // Results
  double? _totalPressureDrop;
  double? _totalEquivalentLength;
  bool _pass = false;
  List<_SectionCalcResult> _results = [];

  @override
  void dispose() {
    _gasRateController.dispose();
    for (final s in _sections) {
      s.dispose();
    }
    super.dispose();
  }

  double _parseDouble(String? text) {
    if (text == null) return 0;
    final t = text.trim();
    if (t.isEmpty) return 0;
    return double.tryParse(t) ?? 0;
  }

  // Fitting equivalent lengths (metres) - grouped by nominal OD
  _FittingEquivLengths _equivLengthsForDiameter(int diameterMm) {
    if (diameterMm <= 15) {
      return const _FittingEquivLengths(
        bend45: 0.20,
        bend90: 0.30,
        elbow90: 0.40,
        teeEntering: 0.75,
        teeExiting: 1.20,
      );
    } else if (diameterMm == 22) {
      return const _FittingEquivLengths(
        bend45: 0.20,
        bend90: 0.30,
        elbow90: 0.60,
        teeEntering: 1.20,
        teeExiting: 1.80,
      );
    } else if (diameterMm == 28) {
      return const _FittingEquivLengths(
        bend45: 0.25,
        bend90: 0.40,
        elbow90: 0.80,
        teeEntering: 1.50,
        teeExiting: 2.30,
      );
    } else {
      // 35mm
      return const _FittingEquivLengths(
        bend45: 0.30,
        bend90: 0.50,
        elbow90: 1.00,
        teeEntering: 2.00,
        teeExiting: 3.00,
      );
    }
  }

  // Equivalent length (m) for one section at a given diameter.
  double _equivalentLengthForSection(
    _PipeSectionControllers s,
    int diameterMm,
  ) {
    final eq = _equivLengthsForDiameter(diameterMm);
    final length = _parseDouble(s.lengthController.text);
    final n45 = _parseDouble(s.bends45Controller.text);
    final nBend90 = _parseDouble(s.formBend90Controller.text);
    final nElbow90 = _parseDouble(s.elbows90Controller.text);
    final nTeeIn = _parseDouble(s.teeEnteringController.text);
    final nTeeOut = _parseDouble(s.teeExitingController.text);

    return length +
        n45 * eq.bend45 +
        nBend90 * eq.bend90 +
        nElbow90 * eq.elbow90 +
        nTeeIn * eq.teeEntering +
        nTeeOut * eq.teeExiting;
  }

  // Pressure drop for a section (mbar) with given diameter & gas rate.
  double _pressureDropForSection({
    required double gasRate,
    required double equivalentLength,
    required int diameterMm,
  }) {
    final k = _kCopperByDiameter[diameterMm];
    if (k == null) return double.infinity;
    final dpPerM = k * math.pow(gasRate, 1.82);
    return dpPerM * equivalentLength;
  }

  void _addSection() {
    if (_sections.length >= _maxSections) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Maximum of 5 sections allowed.')),
      );
      return;
    }
    setState(() {
      _sections.add(
        _PipeSectionControllers(sectionIndex: _sections.length + 1),
      );
    });
  }

  void _removeSection(int index) {
    if (_sections.length == 1) return;
    setState(() {
      final removed = _sections.removeAt(index);
      removed.dispose();
      for (int i = 0; i < _sections.length; i++) {
        _sections[i].sectionIndex = i + 1;
      }
    });
  }

  // Get gas rate for a section: use per-section rate if provided, else total
  double _gasRateForSection(int index) {
    final section = _sections[index];
    final sectionKw = _parseDouble(section.grossKwController.text);
    if (sectionKw > 0) {
      // Convert kW to m3/hr: 1 m3 = 11.2 kWh for natural gas
      // So m3/hr = kW / 11.2 (using net) or kW / 38.76 MJ/m3 * 3.6
      // Simplified: m3/hr = kW / 11.06 (gross CV for NG)
      return sectionKw / 11.06;
    }
    final sectionRate = _parseDouble(section.gasRateController.text);
    if (sectionRate > 0) {
      return sectionRate;
    }
    // Fall back to total gas rate
    return _parseDouble(_gasRateController.text);
  }

  void _calculate() {
    final totalGasRate = _parseDouble(_gasRateController.text);

    // Check that at least one gas rate source is available
    bool hasAnyRate = totalGasRate > 0;
    for (int i = 0; i < _sections.length; i++) {
      if (_gasRateForSection(i) > 0) hasAnyRate = true;
    }
    if (!hasAnyRate) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a gas rate (total or per section).'),
        ),
      );
      return;
    }

    if (_sections.any((s) => _parseDouble(s.lengthController.text) <= 0)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Each section must have a pipe length greater than 0.'),
        ),
      );
      return;
    }

    final n = _sections.length;

    // Get per-section gas rates
    final List<double> sectionGasRates = List.generate(
      n,
      (i) => _gasRateForSection(i),
    );

    // Check all sections have a valid gas rate
    for (int i = 0; i < n; i++) {
      if (sectionGasRates[i] <= 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Section ${i + 1} needs a gas rate.'),
          ),
        );
        return;
      }
    }

    // Precompute equivalent lengths for each section for each diameter.
    final List<Map<int, double>> equivLengths = List.generate(
      n,
      (i) => {
        for (final d in _allowedDiameters)
          d: _equivalentLengthForSection(_sections[i], d),
      },
    );

    // Set starting diameter for each section:
    //  - if locked -> start at its locked diameter
    //  - if auto   -> start at smallest (index 0)
    final List<int> diameterIndex = List<int>.generate(n, (i) {
      final section = _sections[i];
      if (section.isLocked) {
        final idx = _allowedDiameters.indexOf(section.lockedDiameterMm);
        return idx < 0 ? 0 : idx;
      }
      return 0;
    });

    List<_SectionCalcResult> bestResults = [];
    double bestTotalDp = double.infinity;
    double bestTotalLen = 0;
    bool feasible = false;

    // Greedy upsizing: we upsize only AUTO sections, not locked ones.
    while (true) {
      final List<_SectionCalcResult> currentResults = [];
      double totalDp = 0;
      double totalLen = 0;

      for (int i = 0; i < n; i++) {
        final section = _sections[i];
        final d = _allowedDiameters[diameterIndex[i]];
        final l = equivLengths[i][d] ?? 0;
        final dp = _pressureDropForSection(
          gasRate: sectionGasRates[i],
          equivalentLength: l,
          diameterMm: d,
        );
        totalDp += dp;
        totalLen += l;
        currentResults.add(
          _SectionCalcResult(
            sectionName: 'Section ${section.sectionIndex}',
            diameterMm: d,
            equivalentLength: l,
            pressureDropMbar: dp,
            isLocked: section.isLocked,
            gasRateM3hr: sectionGasRates[i],
          ),
        );
      }

      if (totalDp < bestTotalDp) {
        bestTotalDp = totalDp;
        bestTotalLen = totalLen;
        bestResults = currentResults;
      }

      if (totalDp <= _maxPressureDropMbar) {
        feasible = true;
        break;
      }

      // Find the auto section with the highest drop that can still be upsized.
      int worstIdx = -1;
      double worstDp = 0;
      for (int i = 0; i < n; i++) {
        final section = _sections[i];
        if (section.isLocked) continue; // do not change locked sections
        if (diameterIndex[i] >= _allowedDiameters.length - 1) continue;
        final dp = currentResults[i].pressureDropMbar;
        if (dp > worstDp) {
          worstDp = dp;
          worstIdx = i;
        }
      }

      if (worstIdx == -1) {
        // No more upsizing possible on auto sections.
        break;
      }

      // Upsize that auto section.
      diameterIndex[worstIdx] += 1;
    }

    setState(() {
      _results = bestResults;
      _totalPressureDrop = bestTotalDp;
      _totalEquivalentLength = bestTotalLen;
      _pass = feasible && bestTotalDp <= _maxPressureDropMbar;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: _primaryTeal,
        title: const Text('Gas Pipe Sizing'),
      ),
      body: Container(
        color: const Color(0xFFF4F7F7),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildTopCard(),
            const SizedBox(height: 12),
            ..._sections.asMap().entries.map((entry) {
              final index = entry.key;
              final section = entry.value;
              return _buildSectionCard(index, section);
            }),
            const SizedBox(height: 12),
            _buildAddSectionButton(),
            const SizedBox(height: 12),
            _buildCalculateButton(),
            const SizedBox(height: 16),
            _buildResultsCard(),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildTopCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Total Gas Rate (m³/hr)',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            ),
            const SizedBox(height: 4),
            const Text(
              'Simplified Metric Calculation: 1m³ = 11.2kwh',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _gasRateController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                hintText: 'e.g. 3.5',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Enter the total gas rate for this pipe run, or enter a '
              'gas rate per section below.\n'
              'Calculation based on 1.0 mbar max pressure drop (BS 6891, NG).',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionCard(int index, _PipeSectionControllers section) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      color: const Color(0xFFE8F0EF),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Section ${section.sectionIndex}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                const Spacer(),
                if (_sections.length > 1)
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => _removeSection(index),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'Pipe material: Copper (BS 6891)',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
            const SizedBox(height: 12),

            // Per-section gas rate
            Row(
              children: [
                Expanded(
                  child: _buildTextField(
                    label: 'Gross kW',
                    controller: section.grossKwController,
                    hint: 'e.g. 30',
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildTextField(
                    label: 'm³/hr',
                    controller: section.gasRateController,
                    hint: 'or rate',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            const Text(
              'Section gas rate (optional - overrides total rate above)',
              style: TextStyle(fontSize: 10, color: Colors.black45),
            ),
            const SizedBox(height: 8),

            // Pipe size mode buttons
            const Text(
              'Pipe size mode',
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: _modeButton(
                    label: 'AUTO',
                    selected: !section.isLocked,
                    onTap: () {
                      setState(() {
                        section.isLocked = false;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _modeButton(
                    label: 'LOCKED',
                    selected: section.isLocked,
                    onTap: () {
                      setState(() {
                        section.isLocked = true;
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),

            if (section.isLocked) ...[
              const Text(
                'Locked pipe diameter',
                style: TextStyle(fontWeight: FontWeight.w500),
              ),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.black26),
                  color: Colors.white,
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int>(
                    value: section.lockedDiameterMm,
                    items: const [
                      DropdownMenuItem(value: 8, child: Text('8 mm')),
                      DropdownMenuItem(value: 10, child: Text('10 mm')),
                      DropdownMenuItem(value: 15, child: Text('15 mm')),
                      DropdownMenuItem(value: 22, child: Text('22 mm')),
                      DropdownMenuItem(value: 28, child: Text('28 mm')),
                      DropdownMenuItem(value: 35, child: Text('35 mm')),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() => section.lockedDiameterMm = v);
                    },
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            _buildTextField(
              label: 'Pipe length (m)',
              controller: section.lengthController,
              hint: 'Straight length only',
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _buildTextField(
                    label: '45° form bends',
                    controller: section.bends45Controller,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildTextField(
                    label: '90° form bends',
                    controller: section.formBend90Controller,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _buildTextField(
                    label: '90° elbows',
                    controller: section.elbows90Controller,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _buildTextField(
                    label: 'Tee flow entering',
                    controller: section.teeEnteringController,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _buildTextField(
                    label: 'Tee flow exiting',
                    controller: section.teeExitingController,
                  ),
                ),
                const SizedBox(width: 8),
                const Expanded(child: SizedBox()),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _modeButton({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: selected ? _primaryTeal : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? _primaryTeal : Colors.black26,
            width: 1.2,
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : _primaryTeal,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTextField({
    required String label,
    required TextEditingController controller,
    String? hint,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
        const SizedBox(height: 4),
        TextField(
          controller: controller,
          keyboardType:
              const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            hintText: hint,
            border: const OutlineInputBorder(),
            isDense: true,
          ),
        ),
      ],
    );
  }

  Widget _buildAddSectionButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _addSection,
        icon: const Icon(Icons.add),
        label: const Text('Add Another Section'),
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: _primaryTeal,
          side: const BorderSide(color: _primaryTeal),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(30),
          ),
          padding: const EdgeInsets.symmetric(vertical: 14),
        ),
      ),
    );
  }

  Widget _buildCalculateButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _calculate,
        style: ElevatedButton.styleFrom(
          backgroundColor: _primaryTeal,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(30),
          ),
          padding: const EdgeInsets.symmetric(vertical: 16),
        ),
        child: const Text(
          'Calculate Pipe Sizes',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  Widget _buildResultsCard() {
    if (_totalPressureDrop == null || _results.isEmpty) {
      return Card(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Text(
                'Enter gas rate, section lengths and fittings, choose AUTO or '
                'LOCKED pipe size for each section, then tap Calculate.\n\n'
                'The tool will recommend the smallest copper pipe sizes that keep '
                'total pressure drop within 1.0 mbar where possible.',
              ),
              const SizedBox(height: 16.0),
              KwTableWidget(),
            ],
          ),
        ),
      );
    }

    final passColor = _pass ? Colors.green.shade700 : Colors.red.shade700;
    final passText = _pass ? 'PASS' : 'FAIL';

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Results (Recommended Pipe Sizes)',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  passText,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: passColor,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Total pressure drop: '
                  '${_totalPressureDrop!.toStringAsFixed(3)} mbar',
                  style: const TextStyle(fontSize: 14),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Total equivalent length: '
              '${_totalEquivalentLength!.toStringAsFixed(2)} m',
              style: const TextStyle(fontSize: 13, color: Colors.black87),
            ),
            const SizedBox(height: 4),
            const Text(
              'Limit: 1.0 mbar from meter outlet to appliance inlet '
              '(BS 6891, natural gas).',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
            const SizedBox(height: 12),
            const Divider(),
            const SizedBox(height: 8),
            const Text(
              'Per-section recommendations',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Column(
              children: _results
                  .map(
                    (r) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: Text(
                              r.sectionName,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500),
                            ),
                          ),
                          Expanded(
                            flex: 3,
                            child: Text(
                              'Diameter: ${r.diameterMm} mm'
                              '${r.isLocked ? " (locked)" : " (auto)"}',
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                          Expanded(
                            flex: 4,
                            child: Text(
                              'Len: ${r.equivalentLength.toStringAsFixed(2)} m'
                              '\nΔp: ${r.pressureDropMbar.toStringAsFixed(3)} mbar'
                              '\nRate: ${r.gasRateM3hr.toStringAsFixed(3)} m³/hr',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 8),
            const Text(
              'This tool is an aid only. Always verify final pipework design against '
              'current Gas Safe / BS 6891 requirements and manufacturer instructions.',
              style: TextStyle(fontSize: 10, color: Colors.black54),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

// --- Helper classes ---

class _PipeSectionControllers {
  _PipeSectionControllers({required this.sectionIndex});

  int sectionIndex;

  bool isLocked = false;
  int lockedDiameterMm = 22;

  final TextEditingController lengthController = TextEditingController();
  final TextEditingController bends45Controller = TextEditingController();
  final TextEditingController formBend90Controller = TextEditingController();
  final TextEditingController elbows90Controller = TextEditingController();
  final TextEditingController teeEnteringController = TextEditingController();
  final TextEditingController teeExitingController = TextEditingController();
  final TextEditingController grossKwController = TextEditingController();
  final TextEditingController gasRateController = TextEditingController();

  void dispose() {
    lengthController.dispose();
    bends45Controller.dispose();
    formBend90Controller.dispose();
    elbows90Controller.dispose();
    teeEnteringController.dispose();
    teeExitingController.dispose();
    grossKwController.dispose();
    gasRateController.dispose();
  }
}

class _FittingEquivLengths {
  final double bend45;
  final double bend90;
  final double elbow90;
  final double teeEntering;
  final double teeExiting;

  const _FittingEquivLengths({
    required this.bend45,
    required this.bend90,
    required this.elbow90,
    required this.teeEntering,
    required this.teeExiting,
  });
}

class _SectionCalcResult {
  final String sectionName;
  final int diameterMm;
  final double equivalentLength;
  final double pressureDropMbar;
  final bool isLocked;
  final double gasRateM3hr;

  _SectionCalcResult({
    required this.sectionName,
    required this.diameterMm,
    required this.equivalentLength,
    required this.pressureDropMbar,
    required this.isLocked,
    required this.gasRateM3hr,
  });
}

class KwTableWidget extends StatelessWidget {
  KwTableWidget({super.key});

  final List<List<String>> data = [
    ["15 kW", "1.485", "32 kW", "3.169"],
    ["18 kW", "1.782", "35 kW", "3.466"],
    ["24 kW", "2.377", "37 kW", "3.664"],
    ["25 kW", "2.476", "38 kW", "3.763"],
    ["28 kW", "2.773", "40 kW", "3.961"],
    ["30 kW", "2.971", "46 kW", "4.555"],
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFEAF6EE), // light green background like image
        borderRadius: BorderRadius.circular(14),
      ),
      child: Table(
        border: TableBorder.all(
          color: Colors.grey.shade300,
          width: 1,
        ),
        children: data.map((row) {
          return TableRow(
            children: row.asMap().entries.map((entry) {
              int index = entry.key;
              String text = entry.value;

              bool isKwColumn = index % 2 == 0;

              return Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                color: index.isEven
                    ? Colors.white
                    : const Color(0xFFF7FBF8), // slight alternate shade
                child: Center(
                  child: Text(
                    text,
                    style: TextStyle(
                      fontWeight:
                          isKwColumn ? FontWeight.bold : FontWeight.normal,
                      fontSize: 15,
                      color: Colors.black87,
                    ),
                  ),
                ),
              );
            }).toList(),
          );
        }).toList(),
      ),
    );
  }
}
