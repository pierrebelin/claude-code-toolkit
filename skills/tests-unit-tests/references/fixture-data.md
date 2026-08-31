# Fixture: data and repetition

Read only if the test needs DSL, JSON, payloads, constructed objects or several data cases.

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

The test class calls only `WithSampleDiagramNode()` then the handler/service. Do not declare a source, a private builder or a business payload there.

## Repetitive scenarios

```csharp
public static IEnumerable<object?[]> InvalidNames()
{
    yield return [string.Empty, typeof(EmptyNameException)];
    yield return ["   ", typeof(EmptyNameException)];
}
```

Expose `InvalidNames` from the fixture (or a dedicated test provider), then use `MemberData`. Keep `InlineData` only for a trivial technical value, never for business data or a payload.
