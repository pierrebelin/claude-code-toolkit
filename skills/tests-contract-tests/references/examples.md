# Exemples contract

Utiliser seulement si les templates du skill ne suffisent pas. Un test couvre le chemin nominal d'une route ; les erreurs et RM restent dans les TU handler.

## Endpoint nominal

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

Conserver IDs de fixture deterministes. Passer explicitement les headers publics attendus a `VerifyResponse` ; ne pas snapshotter les headers internes ou volatils. Scrubber ULIDs, GUIDs, timestamps et chemins. Revoir chaque fichier `received` avant de le promouvoir en `verified`.
