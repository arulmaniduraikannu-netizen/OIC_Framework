package com.oracle.oic.utils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;
import java.util.Properties;

/**
 * Reads configuration values from config.properties.
 *
 * The configuration is loaded once when the class is initialized.
 * All getters are strongly typed and fail fast when a required
 * property is missing.
 */
public final class ConfigReader {

        private static final String DEFAULT_CONFIG_FILE =
            "config/config.properties";
        private static final String PROFILE =
            System.getProperty("profile", "default").trim().toLowerCase();

    private static final Properties PROPERTIES = new Properties();
    private static boolean profileConfigurationLoaded;

    static {
        loadConfiguration();
    }

    /**
     * Prevent instantiation.
     */
    private ConfigReader() {
        throw new IllegalStateException("Utility class");
    }

    private static String get(String key) {
        String value = resolveOverride(key);

        if (Objects.isNull(value) || value.isBlank()) {

            throw new IllegalArgumentException(
                    "Missing property : " + key);
        }

        String trimmedValue = value.trim();

        if ((trimmedValue.startsWith("\"") && trimmedValue.endsWith("\""))
                || (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))) {
            trimmedValue = trimmedValue.substring(1, trimmedValue.length() - 1);
        }

        return trimmedValue;
    }

    private static void loadConfiguration() {
        String externalConfig = System.getProperty("config.file");
        try {
            if (externalConfig != null && !externalConfig.isBlank()) {
                try (InputStream inputStream = Files.newInputStream(Path.of(externalConfig))) {
                    PROPERTIES.load(inputStream);
                }
                profileConfigurationLoaded = true;
                return;
            }

            String profileConfig = PROFILE.equals("default")
                    ? DEFAULT_CONFIG_FILE
                    : "config/config-" + PROFILE + ".properties";
            InputStream inputStream = ConfigReader.class.getClassLoader()
                    .getResourceAsStream(profileConfig);
            if (inputStream == null) {
                if (!PROFILE.equals("default")) {
                    inputStream = ConfigReader.class.getClassLoader()
                            .getResourceAsStream(DEFAULT_CONFIG_FILE);
                    if (inputStream != null) {
                        PROPERTIES.load(inputStream);
                        return;
                    }
                }
                throw new RuntimeException("Unable to locate configuration file: " + profileConfig);
            }
            try (InputStream configuration = inputStream) {
                PROPERTIES.load(configuration);
            }
            profileConfigurationLoaded = !PROFILE.equals("default");
        } catch (IOException ex) {
            throw new RuntimeException("Unable to load configuration file.", ex);
        }
    }

    private static String resolveOverride(String key) {
        String profileProperty = PROFILE + "." + key;
        String value = System.getProperty(profileProperty);
        if (value == null && !PROFILE.equals("default")) {
            value = System.getenv("OIC_" + PROFILE.toUpperCase() + "_" + key.toUpperCase());
        }
        boolean profileRequired = !PROFILE.equals("default")
                && (key.equals("baseUrl") || key.equals("username") || key.equals("password"));
        if (value == null && (!profileRequired || profileConfigurationLoaded)) {
            value = PROPERTIES.getProperty(key);
        }
        if (value == null && !PROFILE.equals("default")
                && (key.equals("baseUrl") || key.equals("username") || key.equals("password"))
                && !profileConfigurationLoaded) {
            throw new IllegalArgumentException("Missing " + PROFILE.toUpperCase()
                    + " configuration for property: " + key);
        }
        return value;
    }

    // -------------------------------------------------
    // Browser
    // -------------------------------------------------

    public static String getBrowser() {
        return get("browser");
    }

    public static boolean isHeadless() {
        return Boolean.parseBoolean(get("headless"));
    }

    public static int getSlowMo() {
        return Integer.parseInt(get("slowMo"));
    }

    // -------------------------------------------------
    // Application
    // -------------------------------------------------

    public static String getBaseUrl() {
        return get("baseUrl");
    }

    public static String getUsername() {
        return get("username");
    }

    public static String getPassword() {
        return get("password");
    }

    public static String getProfile() {
        return PROFILE;
    }

    // -------------------------------------------------
    // Browser Context
    // -------------------------------------------------

    public static int getViewportWidth() {
        return Integer.parseInt(get("viewportWidth"));
    }

    public static int getViewportHeight() {
        return Integer.parseInt(get("viewportHeight"));
    }

    public static boolean isAcceptDownloads() {
        return Boolean.parseBoolean(get("acceptDownloads"));
    }

    public static boolean isIgnoreHttpsErrors() {
        return Boolean.parseBoolean(get("ignoreHttpsErrors"));
    }

    public static boolean isJavaScriptEnabled() {
        return Boolean.parseBoolean(get("javaScriptEnabled"));
    }

    public static String getLocale() {
        return get("locale");
    }

    // -------------------------------------------------
    // Timeouts
    // -------------------------------------------------

    public static double getActionTimeout() {
        return Double.parseDouble(get("actionTimeout"));
    }

    public static double getNavigationTimeout() {
        return Double.parseDouble(get("navigationTimeout"));
    }

    public static double getReportRenderTimeout() {
        return Double.parseDouble(get("reportRenderTimeout"));
    }

    // -------------------------------------------------
    // Video
    // -------------------------------------------------

    public static boolean isRecordVideo() {
        return Boolean.parseBoolean(get("recordVideo"));
    }
}