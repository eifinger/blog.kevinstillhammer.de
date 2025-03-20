---
layout: post
title: JVM Snapshot testing libraries
excerpt_separator: "<!--more-->"
categories: 
  - Archive
tags:
  - JVM
  - Kotlin
  - Java
  - Snapshot
  - Testing
---

A recent regression in one of our backend services broke the serialization of our JSON responses.
Our existing tests didn't catch the changed serialization which made me look into snapshot testing as an addition to our existing tests.
I already knew snapshot testing libraries in the Python ecosystem but had to find suitable candidates for the JVM ecosystem.
<!--more-->
One of our backend services is a Kotlin SpringBoot application with HTTP/REST endpoints consuming and producing JSON payloads.
To serialize the payloads from/to JSON we use Jackson. We also generate DTOs from our OpenAPI specification.
Due to updating to a new SpringBoot version we also had to update some libraries e.g. Jackson in this whole chain
which is responsible for the serialization of our JSON payloads.

One of these version updates introduced a bug which changed the serialization of boolean values in our JSON payloads.
Fields like `enabled` or `isEnabled` were previously serialized to JSON as `isEnabled`. After the update they were serialized as `enabled`,
dropping the `is` prefix. This change was not caught by our existing tests, not even the end-to-end tests.

The reason this wasn't caught is because in our tests we construct our request objects and do our assertions on the response objects.
We use the same DTOs and serialzation libraries in our tests as in production. This meant the faulty code that removed the `is` prefix
during serialization was happily deserializing the JSON payloads into our DTOs and the tests passed.

We merged the update and rolled out. Soon after other services calling our backend service started breaking.
They were not using the same serialization libraries, versions or event the same programming language.
They were looking for the `isEnabled` field in the JSON payload and not finding it.

This made me look into snapshot testing as an addition to our existing tests to make sure that our JSON payloads are serialized correctly.

## What is snapshot testing?

Snapshot testing is a testing technique where the output of a function or component is compared to a previously saved "snapshot" of the expected output. This isn't particularly helpful if you are developing with a TDD approach but can be useful for regression or contract testing where you
want to make sure that a certain output doesn't change over time.

Some snapshot testing libraries really take snapshots/screenshots of your UI to make sure that not a single pixel changed.
We are not interested in this kind of snapshot testing. But in a simple "Did that string change?" or "Did that JSON payload change?".

## Criteria

To select a suitable snapshot testing library for our project we defined the following criteria:

- **Easy to use**: The library should be easy to use and integrate into our project.
- **Low/No transitive dependencies**: The library should not leak any additional dependencies into our project.
- **Low complexity**: The library should be easy to understand and maintain. In case it gets abandoned, it should be easy to fix bugs on our own.
- **Active development**: The library should be actively maintained and updated.

## Candidates

We identified the following candidates by searching Google and asking ChatGPT as well as friends and colleagues.

- [Java Snapshot Matcher](#java-snapshot-matcher)
- [KotlinSnapshot](#kotlinsnapshot)
- [Java Snapshot Testing](#java-snapshot-testing)
- [selfie](#selfie)
- [ApprovalTests.Java](#approvaltestsjava)

### Java Snapshot Matcher

[Zenika/java-snapshot-matcher](https://github.com/Zenika/java-snapshot-matcher)

- Only supports single snapshot per test method
- Brings in mandatory dependencies like hamcrest
- unmaintained since 2019
- Only seems to work with hamcrest assert framework

Since we are using AssertJ in our project, the mandatory use of hamcrest was a showstopper early in the evaluation.
Being unmaintained for over 5 years and a very small featureset did not help either.

### KotlinSnapshot

[pedrovgs/KotlinSnapshot](https://github.com/pedrovgs/KotlinSnapshot)

- Unmaintained since 2022
- Uses GSON internally
- Not possible to globally set the snapshot directory

Skimming through the codebase and documentation showed that this unmaintained library would place the snapshots
next the the test classes which we really disliked. It also had a hard dependency on GSON which we didn't want to introduce into our project.

### Java Snapshot Testing

[origin-energy/java-snapshot-testing](https://github.com/origin-energy/java-snapshot-testing)

- No transitive dependencies
- JUnit support
- Configuration via snapshot.properties file
- No support for dynamic parts in snapshots like ApprovalTests

Java Snapshot Testing feels like it brings just enough features and configurability without being overly complex.
Adding it to your project will not introduce other transitive dependencies and it can be globally configured via a `snapshot.properties` file.

It integrates with JUnit and is straightforward to use by following the
[quick-start](https://github.com/origin-energy/java-snapshot-testing?tab=readme-ov-file#quick-start-junit5--gradle-example):

```kotlin
import au.com.origin.snapshots.Expect
import au.com.origin.snapshots.junit5.SnapshotExtension

@ExtendWith(SnapshotExtension::class)
class SerializationTest {
    private lateinit var expect: Expect
    private lateinit var device: Device

    @BeforeAll
    fun setUp() {
        device = setupDevice()  // Setup excluded for brevity
    }

    @Test
    fun `test get assembled device serialization`() {
        val response = getRequest("/v1/devices/${device.serialNumber}")
        val rawJsonResponse = response.body()
        expect.toMatchSnapshot(rawJsonResponse)
    }
}
```

Its simplicity has a drawback in comparision to ApprovalTests or selfie.
If you have dynamic parts in your API responses, like a timestamp or a UUID, you have to manually scrub them from the snapshot.

This library will be our goto for basic snapshot testing in the feature but for our backend service,
which does have dynamic parts in the resposes, it was wasn't a good fit.

### selfie

[diffplug/selfie](https://github.com/diffplug/selfie)

- Most complex candidate
- Diffplug is known for their high quality libraries
- Could not get it to work in our project which uses e2e tests with a different source set
- I do not like that fact that the library will rewrite my test source code

Selfie is definitely the candidate with the [fanciest documentation](https://selfie.dev/).
At first glance it also seems the most powerful library but also featuring the most complex source code.
This would be hard to maintain in case it gets abandoned but on the plus side
Diffplug is known for their high quality libraries and has a good track record of maintaining them.

Adding it to your project will bring in some transitive dependencies but only kotlin standardlib and Junit stuff so not that bad.

Selfie was the only library we tried to use and couldn't get it to work in our project.
We have a multi-module project with a backend service and an e2e test module. The e2e test module has a different source set and
that doesn't seem to work with selfie out of the box.

We also didn't like the fact that the library rewrites the test source code when creating/updating the snapshots.

### ApprovalTests.Java

[approvals/approvaltests.java](https://github.com/approvals/approvaltests.java)

- Automatically opens the diff tool
- Stores setting in a simple PackageSetting class
- No transitive dependencies
- No automatic detection of parameterized tests, but support for it

We decided to go with ApprovalTests.Java as our snapshot testing library of choice.

ApprovalTests doesn't have the simplest source code but it was easy to get started and the documentation had everything we were looking for.
Adding it to your project will not bring in any transitive dependencies. Configuration was also easy via either inline configs or `PackageSettings` classes instead of configuration files.

Where java-snapshot-testing does not support dynamic parts in the snapshots, ApprovalTests has a powerful scrubbing mechanism to remove dynamic parts from the snapshots. In general it was fun using the library as it has a good documentation is really easy to use.

We don't need to add extra annotations or use an `expect` object like in java-snapshot-testing.
I wrote this article before using both libraries in depths so this is just my first impression.

```kotlin
import org.approvaltests.Approvals
import org.approvaltests.core.Options
import org.approvaltests.scrubbers.RegExScrubber

class SerializationTest {
    private lateinit var device: Device

    @BeforeAll
    fun setUp() {
        device = setupDevice()  // Setup excluded for brevity
    }

    @Test
    fun `test get assembled device serialization`() {
        val response = getRequest("/v1/devices/${device.serialNumber}")
        val rawJsonResponse = response.body()
        // Scrubbers could also be created in a centralized place and reused across the project.
        val scrubber = RegExScrubber("\"serialNumber\":\"[A-Z]{2}\\d{10}\"", "\"serialNumber\":\"[serialNumber]\"")
        Approvals.verify(rawJsonResponse, Options(scrubber))
    }
}
```
