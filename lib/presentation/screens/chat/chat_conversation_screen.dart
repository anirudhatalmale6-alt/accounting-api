import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../data/services/chat_service.dart';

class ChatConversationScreen extends StatefulWidget {
  final bool isGroup;
  final int? recipientId;
  final String title;

  const ChatConversationScreen({
    super.key,
    required this.isGroup,
    this.recipientId,
    required this.title,
  });

  @override
  State<ChatConversationScreen> createState() => _ChatConversationScreenState();
}

class _ChatConversationScreenState extends State<ChatConversationScreen> {
  final ChatService _chatService = ChatService();
  final TextEditingController _msgCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();

  List<dynamic> messages = [];
  bool loading = true;
  bool sending = false;
  bool loadingMore = false;
  int? myUserId;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _loadUserId();
    _loadMessages();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _pollNewMessages();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadUserId() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      myUserId = prefs.getInt("userId");
    });
  }

  Future<void> _loadMessages() async {
    setState(() => loading = true);
    try {
      if (widget.isGroup) {
        messages = await _chatService.getGroupMessages();
      } else {
        messages =
            await _chatService.getDirectMessages(widget.recipientId!);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error: $e")),
        );
      }
    }
    if (mounted) {
      setState(() => loading = false);
      _scrollToBottom();
    }
  }

  Future<void> _pollNewMessages() async {
    if (!mounted || loading || sending) return;
    try {
      List<dynamic> fresh;
      if (widget.isGroup) {
        fresh = await _chatService.getGroupMessages();
      } else {
        fresh = await _chatService.getDirectMessages(widget.recipientId!);
      }
      if (mounted && fresh.length != messages.length) {
        setState(() => messages = fresh);
        _scrollToBottom();
      }
    } catch (_) {}
  }

  Future<void> _loadOlderMessages() async {
    if (loadingMore || messages.isEmpty) return;
    setState(() => loadingMore = true);
    try {
      final firstId = messages.first["id"];
      List<dynamic> older;
      if (widget.isGroup) {
        older = await _chatService.getGroupMessages(before: firstId);
      } else {
        older = await _chatService.getDirectMessages(widget.recipientId!,
            before: firstId);
      }
      if (older.isNotEmpty && mounted) {
        setState(() {
          messages = [...older, ...messages];
        });
      }
    } catch (_) {}
    if (mounted) setState(() => loadingMore = false);
  }

  Future<void> _send() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty || sending) return;

    setState(() => sending = true);
    try {
      Map<String, dynamic> sent;
      if (widget.isGroup) {
        sent = await _chatService.sendGroupMessage(text);
      } else {
        sent = await _chatService.sendDirectMessage(
            widget.recipientId!, text);
      }
      _msgCtrl.clear();
      setState(() => messages.add(sent));
      _scrollToBottom();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Failed to send: $e")),
        );
      }
    }
    if (mounted) setState(() => sending = false);
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String _formatTime(String? dateStr) {
    if (dateStr == null) return "";
    final d = DateTime.tryParse(dateStr)?.toLocal();
    if (d == null) return "";
    final now = DateTime.now();
    final time =
        "${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}";
    if (d.year == now.year && d.month == now.month && d.day == now.day) {
      return time;
    }
    return "${d.day}/${d.month} $time";
  }

  String _senderName(Map<String, dynamic> msg) {
    final email = msg["sender_email"]?.toString() ?? "";
    final atIndex = email.indexOf("@");
    if (atIndex > 0) return email.substring(0, atIndex);
    return "User #${msg["sender_id"]}";
  }

  Color _roleColor(String? role) {
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(
              widget.isGroup ? Icons.groups : Icons.person,
              size: 22,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                widget.title,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _loadMessages,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Messages list
                Expanded(
                  child: messages.isEmpty
                      ? const Center(
                          child: Text(
                            "No messages yet.\nSay hello!",
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.grey, fontSize: 16),
                          ),
                        )
                      : NotificationListener<ScrollNotification>(
                          onNotification: (notification) {
                            if (notification is ScrollUpdateNotification &&
                                _scrollCtrl.position.pixels <=
                                    _scrollCtrl.position.minScrollExtent +
                                        50) {
                              _loadOlderMessages();
                            }
                            return false;
                          },
                          child: ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            itemCount: messages.length +
                                (loadingMore ? 1 : 0),
                            itemBuilder: (_, i) {
                              if (loadingMore && i == 0) {
                                return const Center(
                                  child: Padding(
                                    padding: EdgeInsets.all(8),
                                    child: SizedBox(
                                      width: 20,
                                      height: 20,
                                      child:
                                          CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  ),
                                );
                              }
                              final idx = loadingMore ? i - 1 : i;
                              final msg = messages[idx] as Map<String, dynamic>;
                              final isMe = msg["sender_id"] == myUserId;

                              return _buildBubble(msg, isMe);
                            },
                          ),
                        ),
                ),

                // Input bar
                Container(
                  padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                  decoration: BoxDecoration(
                    color: Theme.of(context).scaffoldBackgroundColor,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.05),
                        blurRadius: 4,
                        offset: const Offset(0, -2),
                      ),
                    ],
                  ),
                  child: SafeArea(
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _msgCtrl,
                            textCapitalization:
                                TextCapitalization.sentences,
                            maxLines: 4,
                            minLines: 1,
                            decoration: InputDecoration(
                              hintText: "Type a message...",
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(24),
                              ),
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 10),
                              isDense: true,
                            ),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        const SizedBox(width: 8),
                        CircleAvatar(
                          backgroundColor: Theme.of(context).primaryColor,
                          child: IconButton(
                            icon: sending
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(Icons.send, color: Colors.white,
                                    size: 20),
                            onPressed: _send,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildBubble(Map<String, dynamic> msg, bool isMe) {
    final role = msg["sender_role"]?.toString();

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
        decoration: BoxDecoration(
          color: isMe
              ? Theme.of(context).primaryColor.withOpacity(0.15)
              : Colors.grey.shade100,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment:
              isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            if (widget.isGroup && !isMe)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  _senderName(msg),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: _roleColor(role),
                  ),
                ),
              ),
            Text(
              msg["message"]?.toString() ?? "",
              style: const TextStyle(fontSize: 15),
            ),
            const SizedBox(height: 2),
            Text(
              _formatTime(msg["created_at"]?.toString()),
              style: const TextStyle(fontSize: 10, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
