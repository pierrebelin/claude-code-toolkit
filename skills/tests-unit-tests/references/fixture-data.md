# Fixture : données et répétitions

Lire seulement si le test nécessite du DSL, JSON, payloads, objets construits ou plusieurs cas de données.

## Données métier dans la fixture

```csharp
public sealed class GenerationServiceFixture
{
    private const string SampleDiagramNodeSource = """
        node SampleNode { inputs { Data: Binary } }
        """;

    public GenerationServiceFixture WithSampleDiagramNode()
    {
        _resolvedProject = ResolvedProjectBuilder.Create()
            .WithFiles([SampleDiagramNodeSource], ["components/sample-node.dsl"])
            .Build();
        return this;
    }
}
```

La classe de test appelle seulement `WithSampleDiagramNode()` puis le handler/service. Ne pas y déclarer source, builder privé ou payload métier.

## Scénarios répétitifs

```csharp
public static IEnumerable<object?[]> InvalidNames()
{
    yield return [string.Empty, typeof(EmptyNameException)];
    yield return ["   ", typeof(EmptyNameException)];
}
```

Exposer `InvalidNames` depuis la fixture (ou un fournisseur dédié de test), puis utiliser `MemberData`. Garder `InlineData` uniquement pour une valeur technique triviale, jamais pour une donnée métier ou un payload.
