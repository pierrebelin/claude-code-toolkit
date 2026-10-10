# E2E lifecycle patterns

Only when the selected lifecycle needs more than the minimal template.

## Stable reference data

```csharp
var categories = await fixture.Client.GetProductCategories(CancellationToken.None);
Assert.True(categories.IsSuccess);
Assert.NotEmpty(categories.Value!.Categories);
var categoryId = categories.Value.Categories[0].Id;
```

Read reference data, don't modify it. Mutable data the test creates is deleted at the end of the journey.

## API dependencies

```csharp
var parent = await fixture.Client.CreateParentAsync(
    ParentFixture.CreateRequest(), CancellationToken.None);
Assert.True(parent.IsSuccess);

var child = await fixture.Client.CreateChildAsync(
    ChildFixture.CreateRequest(parent.Value), CancellationToken.None);
Assert.True(child.IsSuccess);
```

Create dependencies in business order, through the API.

## Temporarily blocked test

```csharp
[Fact(Skip = "Blocked: CreateChild endpoint is absent from SDK")]
public async Task ShouldCompleteLifecycle_WhenCreateThenActivateThenDelete()
{
    throw new NotImplementedException();
}
```

Remove `Skip` as soon as route and SDK exist.
