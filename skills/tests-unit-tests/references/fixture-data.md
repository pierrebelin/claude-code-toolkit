# Fixture: data and repetition

Read only for DSL, JSON, payloads, constructed objects or several data cases.

## Business data in the fixture

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

Test class calls `WithSampleDiagramNode()` then the handler/service. No source, private builder or business payload there.

## Repetitive scenarios

```csharp
public static IEnumerable<object?[]> InvalidNames()
{
    yield return [string.Empty, typeof(EmptyNameException)];
    yield return ["   ", typeof(EmptyNameException)];
}
```

Expose `InvalidNames` from fixture (or dedicated test provider), then `MemberData`. `InlineData` only for a trivial technical value, never business data or payload.
