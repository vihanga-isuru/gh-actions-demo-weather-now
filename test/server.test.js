const request = require("supertest");

const ORIGINAL_ENV = { ...process.env };

function loadApp() {
    // server.js reads OPENWEATHER_API_KEY at request time, and caches nothing
    // at module load, so re-requiring isn't strictly required — but resetting
    // modules keeps each test isolated if that ever changes.
    jest.resetModules();
    return require("../src/server");
}

function mockFetchOnce(implementation) {
    jest.spyOn(global, "fetch").mockImplementationOnce(implementation);
}

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

describe("WeatherNow API", () => {

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV, OPENWEATHER_API_KEY: "test-key" };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("static site", () => {
        test("GET / should return the website", async () => {
            const app = loadApp();

            const response = await request(app).get("/");

            expect(response.statusCode).toBe(200);
        });
    });

    describe("input validation", () => {
        test("missing city should return 400", async () => {
            const app = loadApp();

            const response = await request(app).get("/api/weather");

            expect(response.statusCode).toBe(400);
            expect(response.body.error).toBe("City is required");
        });

        test("blank/whitespace city should return 400", async () => {
            const app = loadApp();

            const response = await request(app).get("/api/weather?city=%20%20");

            expect(response.statusCode).toBe(400);
            expect(response.body.error).toBe("City is required");
        });

        test("excessively long city should return 400", async () => {
            const app = loadApp();
            const longCity = "a".repeat(101);

            const response = await request(app)
                .get("/api/weather")
                .query({ city: longCity });

            expect(response.statusCode).toBe(400);
            expect(response.body.error).toBe("City name is too long");
        });

        test("city with invalid characters should return 400", async () => {
            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "London<script>" });

            expect(response.statusCode).toBe(400);
            expect(response.body.error).toBe("City name contains invalid characters");
        });
    });

    describe("upstream success", () => {
        test("valid city returns mapped weather data", async () => {
            mockFetchOnce(async () => jsonResponse(200, {
                name: "London",
                sys: { country: "GB" },
                main: { temp: 14.4, feels_like: 12.9, humidity: 82 },
                weather: [{ description: "overcast clouds", icon: "04d" }],
                wind: { speed: 4.1 }
            }));

            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "London" });

            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual({
                city: "London",
                country: "GB",
                temperature: 14,
                feelsLike: 13,
                description: "overcast clouds",
                humidity: 82,
                windSpeed: 4.1,
                icon: "04d"
            });
        });
    });

    describe("upstream errors", () => {
        test("city not found (404) should return 404", async () => {
            mockFetchOnce(async () => jsonResponse(404, { message: "city not found" }));

            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "Nowhereville" });

            expect(response.statusCode).toBe(404);
            expect(response.body.error).toBe("City not found");
        });

        test("other upstream error status should pass through", async () => {
            mockFetchOnce(async () => jsonResponse(401, { message: "invalid key" }));

            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "London" });

            expect(response.statusCode).toBe(401);
            expect(response.body.error).toBe("Failed to retrieve weather data");
        });

        test("network failure should return 500", async () => {
            mockFetchOnce(async () => {
                throw new TypeError("fetch failed");
            });

            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "London" });

            expect(response.statusCode).toBe(500);
            expect(response.body.error).toBe("Unable to connect to weather service");
        });

        test("timeout/abort should return 504", async () => {
            mockFetchOnce(async () => {
                const error = new Error("The operation was aborted");
                error.name = "AbortError";
                throw error;
            });

            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "London" });

            expect(response.statusCode).toBe(504);
            expect(response.body.error).toBe("Weather service took too long to respond");
        });
    });

    describe("configuration", () => {
        test("missing API key should return 500", async () => {
            delete process.env.OPENWEATHER_API_KEY;
            const app = loadApp();

            const response = await request(app)
                .get("/api/weather")
                .query({ city: "London" });

            expect(response.statusCode).toBe(500);
            expect(response.body.error).toBe("OpenWeather API key is not configured");
        });
    });

});