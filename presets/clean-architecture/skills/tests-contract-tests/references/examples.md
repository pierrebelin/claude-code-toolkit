# Contract examples

Only when the skill's templates are not enough. A test covers a route's nominal path; errors and business rules stay in handler unit tests.

## Nominal endpoint

```csharp
namespace {{PRODUCT}}.ContractTests.[Feature];

public class Create[Entity]Tests : BaseEndpointTests
{
    [Fact]
    public async Task ShouldCreate[Entity]()
    {
        var request = new Create[Entity]Request { Name = "Test" };

        var response = await Client.PostAsJsonAsync("entities", request);

        await VerifyResponse(response);
    }
}
```

## Base class snapshot

A suite without `BaseEndpointTests` starts from this shape: request method, path and body, the `Location` header, status and body, serialized once.

```csharp
protected async Task VerifyResponse(HttpResponseMessage response)
{
    ArgumentNullException.ThrowIfNull(response);

    var content = await ExtractContent(response, _requestBodyHandler.LastRequestBody);
    await Verify(content, _verifySettings);
}

private static async Task<string> ExtractContent(HttpResponseMessage response, string? requestBody)
{
    var responseContent = await response.Content.ReadAsStringAsync();
    var responseHeaders = response.Headers
        .ToDictionary(x => x.Key, x => x.Value)
        .Where(x => x.Key == "Location");

    var contract = new
    {
        Request = requestBody is not null
            ? new { response.RequestMessage!.Method, RequestUri = response.RequestMessage.RequestUri!.PathAndQuery, Body = requestBody }
            : new { response.RequestMessage!.Method, RequestUri = response.RequestMessage.RequestUri!.PathAndQuery } as object,
        Response = new
        {
            Headers = responseHeaders,
            response.StatusCode,
            Content = responseContent
        }
    };

    return JsonSerializer.Serialize(contract, s_contractSerializerOptions);
}
```

`_requestBodyHandler` = a `DelegatingHandler` on the test client keeping the last request body. Fixture ids deterministic; scrub ULIDs, GUIDs, timestamps, paths. Review every `received` file before promoting it to `verified`.
