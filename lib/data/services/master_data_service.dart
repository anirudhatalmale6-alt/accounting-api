import 'api_client.dart';

class MasterDataService {
  Future<List<dynamic>> getCustomers() async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/customers");
    return res.data is List ? res.data : (res.data["customers"] ?? []);
  }
}
