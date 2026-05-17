import 'package:flutter/material.dart';

import '../../../data/services/chat_service.dart';
import 'chat_conversation_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  final ChatService _chatService = ChatService();

  bool loading = true;
  List<dynamic> contacts = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      contacts = await _chatService.getContacts();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error: $e")),
        );
      }
    }
    if (mounted) setState(() => loading = false);
  }

  Color _roleColor(String role) {
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

  IconData _roleIcon(String role) {
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

  String _displayName(Map<String, dynamic> contact) {
    final email = contact["email"]?.toString() ?? "";
    final atIndex = email.indexOf("@");
    if (atIndex > 0) return email.substring(0, atIndex);
    return email.isNotEmpty ? email : "User #${contact["id"]}";
  }

  String _timeAgo(String? dateStr) {
    if (dateStr == null) return "";
    final date = DateTime.tryParse(dateStr);
    if (date == null) return "";
    final diff = DateTime.now().difference(date);
    if (diff.inMinutes < 1) return "now";
    if (diff.inMinutes < 60) return "${diff.inMinutes}m ago";
    if (diff.inHours < 24) return "${diff.inHours}h ago";
    if (diff.inDays < 7) return "${diff.inDays}d ago";
    return "${date.day}/${date.month}/${date.year}";
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Chat"),
        actions: [
          IconButton(
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                children: [
                  // Group chat tile
                  Card(
                    margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: Colors.indigo,
                        radius: 24,
                        child: const Icon(Icons.groups, color: Colors.white),
                      ),
                      title: const Text(
                        "Team Chat",
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: const Text("Everyone in your company"),
                      trailing:
                          const Icon(Icons.chevron_right, color: Colors.grey),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ChatConversationScreen(
                              isGroup: true,
                              title: "Team Chat",
                            ),
                          ),
                        ).then((_) => _load());
                      },
                    ),
                  ),

                  // Divider
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: Text(
                      "DIRECT MESSAGES",
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: Colors.grey,
                        letterSpacing: 1,
                      ),
                    ),
                  ),

                  if (contacts.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(32),
                      child: Center(
                        child: Text(
                          "No team members yet.\nInvite people from Team Management.",
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey),
                        ),
                      ),
                    ),

                  // Contact list
                  ...contacts.map((c) {
                    final role = c["role"]?.toString() ?? "engineer";
                    final name = _displayName(c);
                    final lastMsg = c["last_message"]?.toString();
                    final lastTime = c["last_message_at"]?.toString();

                    return Card(
                      margin: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 3),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: _roleColor(role),
                          child: Icon(_roleIcon(role), color: Colors.white,
                              size: 20),
                        ),
                        title: Text(
                          name,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: lastMsg != null
                            ? Text(
                                lastMsg,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 13),
                              )
                            : Text(
                                role[0].toUpperCase() + role.substring(1),
                                style: const TextStyle(
                                    fontSize: 13, color: Colors.grey),
                              ),
                        trailing: lastTime != null
                            ? Text(
                                _timeAgo(lastTime),
                                style: const TextStyle(
                                    fontSize: 11, color: Colors.grey),
                              )
                            : null,
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => ChatConversationScreen(
                                isGroup: false,
                                recipientId: c["id"],
                                title: name,
                              ),
                            ),
                          ).then((_) => _load());
                        },
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }
}
