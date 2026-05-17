import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../data/services/api_client.dart';

class AcceptInviteScreen extends StatefulWidget {
  const AcceptInviteScreen({super.key});

  @override
  State<AcceptInviteScreen> createState() => _AcceptInviteScreenState();
}

class _AcceptInviteScreenState extends State<AcceptInviteScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmPasswordCtrl = TextEditingController();

  bool _loading = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  Future<void> _accept() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _loading = true);

    try {
      final api = await ApiClient.create();
      final res = await api.dio.post("/auth/accept-invite", data: {
        "email": _emailCtrl.text.trim().toLowerCase(),
        "inviteCode": _codeCtrl.text.trim(),
        "password": _passwordCtrl.text,
      });

      final data = res.data;
      final token = data["token"];
      final user = data["user"];

      if (token != null) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString("token", token);
        await prefs.setInt("userId", user["id"]);
        await prefs.setString("userEmail", user["email"] ?? "");
        await prefs.setString("userRole", user["role"] ?? "");
        await prefs.setInt("companyId", user["company_id"] ?? 0);

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text("Invitation accepted! Welcome aboard."),
              backgroundColor: Colors.green,
            ),
          );

          Navigator.of(context).pushNamedAndRemoveUntil(
            "/home",
            (route) => false,
          );
        }
      }
    } catch (e) {
      if (mounted) {
        String errorMsg = "Failed to accept invitation";
        if (e.toString().contains("404")) {
          errorMsg = "Invalid or expired invitation code";
        } else if (e.toString().contains("409")) {
          errorMsg = "You are already a member of this company";
        } else if (e.toString().contains("400")) {
          errorMsg = "Email does not match the invitation";
        }

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(errorMsg),
            backgroundColor: Colors.red,
          ),
        );
      }
    }

    if (mounted) setState(() => _loading = false);
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _codeCtrl.dispose();
    _passwordCtrl.dispose();
    _confirmPasswordCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Accept Invitation"),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(
                Icons.mail_outline,
                size: 64,
                color: Colors.blue,
              ),
              const SizedBox(height: 16),
              const Text(
                "Join Your Team",
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                "Enter the invitation code from your email and create your password to get started.",
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.black54,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 32),
              TextFormField(
                controller: _emailCtrl,
                decoration: const InputDecoration(
                  labelText: "Email Address",
                  prefixIcon: Icon(Icons.email_outlined),
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                validator: (v) {
                  if (v == null || v.trim().isEmpty) {
                    return "Email is required";
                  }
                  if (!v.contains("@")) {
                    return "Enter a valid email";
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _codeCtrl,
                decoration: const InputDecoration(
                  labelText: "Invitation Code",
                  prefixIcon: Icon(Icons.vpn_key_outlined),
                  border: OutlineInputBorder(),
                  helperText: "Check your email for the code",
                ),
                autocorrect: false,
                validator: (v) {
                  if (v == null || v.trim().isEmpty) {
                    return "Invitation code is required";
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passwordCtrl,
                decoration: InputDecoration(
                  labelText: "Password",
                  prefixIcon: const Icon(Icons.lock_outlined),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscurePassword
                          ? Icons.visibility_off
                          : Icons.visibility,
                    ),
                    onPressed: () {
                      setState(() => _obscurePassword = !_obscurePassword);
                    },
                  ),
                ),
                obscureText: _obscurePassword,
                validator: (v) {
                  if (v == null || v.isEmpty) {
                    return "Password is required";
                  }
                  if (v.length < 6) {
                    return "Password must be at least 6 characters";
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _confirmPasswordCtrl,
                decoration: InputDecoration(
                  labelText: "Confirm Password",
                  prefixIcon: const Icon(Icons.lock_outlined),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscureConfirm
                          ? Icons.visibility_off
                          : Icons.visibility,
                    ),
                    onPressed: () {
                      setState(() => _obscureConfirm = !_obscureConfirm);
                    },
                  ),
                ),
                obscureText: _obscureConfirm,
                validator: (v) {
                  if (v != _passwordCtrl.text) {
                    return "Passwords do not match";
                  }
                  return null;
                },
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 50,
                child: ElevatedButton(
                  onPressed: _loading ? null : _accept,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: _loading
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          "Accept Invitation",
                          style: TextStyle(fontSize: 16),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
