# E2E lifecycle patterns

Read only if the selected lifecycle needs more than the minimal template.

## Stable reference data

```csharp
var blueprints = await fixture.Client.GetBlueprints(CancellationToken.None);
Assert.True(blueprints.IsSuccess);
Assert.NotEmpty(blueprints.Value!.Blueprints);
var blueprintId = blueprints.Value.Blueprints[0].Id;
```

Read the reference data, do not modify it. Any mutable data the test creates is deleted at the end of the journey.

## API dependencies

```csharp
var parent = await fixture.Client.CreateParentAsync(
    ParentFixture.CreateRequest(), CancellationToken.None);
Assert.True(parent.IsSuccess);

var child = await fixture.Client.CreateChildAsync(
    ChildFixture.CreateRequest(parent.Value), CancellationToken.None);
Assert.True(child.IsSuccess);
```

Create the dependencies in the required business order, never through database access.

## Temporarily blocked test

```csharp
[Fact(Skip = "Blocked: CreateChild endpoint is absent from SDK")]
public async Task ShouldCompleteLifecycle_WhenCreateThenActivateThenDelete()
{
    throw new NotImplementedException();
}
```

Remove `Skip` as soon as the route and the SDK are available.
