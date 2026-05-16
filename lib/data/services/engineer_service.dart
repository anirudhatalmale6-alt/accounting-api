import 'api_client.dart';

class EngineerService {
  Future<List<dynamic>> getEngineers() async {
    final api = await ApiClient.create();

    final res = await api.dio.get("/engineers");

    return res.data["engineers"] ?? [];
  }

  Future<void> createEngineer({
    required String name,
    String? email,
    String? phone,
    String colour = "#2563EB",
  }) async {
    final api = await ApiClient.create();

    await api.dio.post(
      "/engineers",
      data: {
        "name": name,
        "email": email,
        "phone": phone,
        "colour": colour,
      },
    );
  }

  Future<void> updateEngineer({
    required int id,
    required String name,
    String? email,
    String? phone,
    String colour = "#2563EB",
    bool isActive = true,
  }) async {
    final api = await ApiClient.create();

    await api.dio.put(
      "/engineers/$id",
      data: {
        "name": name,
        "email": email,
        "phone": phone,
        "colour": colour,
        "isActive": isActive,
      },
    );
  }
}
