import 'api_client.dart';

class VatService {
  Future<Map<String, dynamic>> getVatReturn({
    required String dateFrom,
    required String dateTo,
  }) async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/vat/return", queryParameters: {
      "dateFrom": dateFrom,
      "dateTo": dateTo,
    });
    return res.data;
  }

  Future<Map<String, dynamic>> getVatSummary({
    required String dateFrom,
    required String dateTo,
  }) async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/vat/summary", queryParameters: {
      "dateFrom": dateFrom,
      "dateTo": dateTo,
    });
    return res.data;
  }

  Future<Map<String, dynamic>> getHmrcStatus() async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/hmrc/status");
    return res.data;
  }

  Future<Map<String, dynamic>> submitVatReturn({
    required String vrn,
    required Map<String, dynamic> vatData,
    required Map<String, String> deviceHeaders,
  }) async {
    final api = await ApiClient.create();
    final res = await api.dio.post(
      "/hmrc/vat-submit",
      data: {"vrn": vrn, "vatData": vatData},
      options: api.dio.options.copyWith(headers: deviceHeaders),
    );
    return res.data;
  }

  Future<List<dynamic>> getSubmissionHistory() async {
    final api = await ApiClient.create();
    final res = await api.dio.get("/hmrc/vat-submissions");
    return res.data["items"] ?? [];
  }
}
