import 'api_client.dart';

class ChatService {
  Future<List<dynamic>> getGroupMessages({int? before}) async {
    final api = await ApiClient.create();
    final params = <String, dynamic>{"limit": 50};
    if (before != null) params["before"] = before;
    final res = await api.dio.get("/chat/group", queryParameters: params);
    return res.data["messages"] ?? [];
  }

  Future<Map<String, dynamic>> sendGroupMessage(String message) async {
    final api = await ApiClient.create();
    final res = await api.dio.post("/chat/group", data: {"message": message});
    return res.data;
  }

  Future<List<dynamic>> getDirectMessages(int userId, {int? before}) async {
    final api = await ApiClient.create();
    final params = <String, dynamic>{"limit": 50};
    if (before != null) params["before"] = before;
    final res =
        await api.dio.get("/chat/direct/$userId", queryParameters: params);
    return res.data["messages"] ?? [];
  }

  Future<Map<String, dynamic>> sendDirectMessage(
      int userId, String message) async {
    final api = await ApiClient.create();
    final res =
        await api.dio.post("/chat/direct/$userId", data: {"message": message});
    return res.data;
  }

  Future<List<dynamic>> getContacts() async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/chat/contacts");
    return res.data["contacts"] ?? [];
  }
}
