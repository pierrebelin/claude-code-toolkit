# Contract examples

Use only when the skill's templates are not enough. A test covers a route's nominal path; errors and business rules stay in the handler unit tests.

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

        await VerifyResponse(response, "Location", "Content-Type");
    }
}
```

## Snapshot stable

```csharp
protected async Task VerifyResponse(HttpResponseMessage response, params string[] expectedHeaderNames)
{
    var content = await response.Content.ReadAsStringAsync();
    var expectedHeaders = expectedHeaderNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
    var contract = new
    {
        Request = new
        {
            response.RequestMessage!.Method,
            RequestUri = response.RequestMessage.RequestUri!.PathAndQuery
        },
        Response = new
        {
            response.StatusCode,
            Headers = response.Headers
                .Concat(response.Content.Headers)
                .Where(header => expectedHeaders.Contains(header.Key))
                .OrderBy(header => header.Key)
                .ToDictionary(
                    header => header.Key,
                    header => header.Value.OrderBy(value => value).ToArray()),
            Content = content
        }
    };

    await Verify(JsonSerializer.Serialize(contract, new JsonSerializerOptions
    {
        WriteIndented = true
    }), VerifySettings);
}
```

Keep the fixture IDs deterministic. Pass the expected public headers explicitly to `VerifyResponse`; do not snapshot internal or volatile headers. Scrub ULIDs, GUIDs, timestamps and paths. Review every `received` file before promoting it to `verified`.
