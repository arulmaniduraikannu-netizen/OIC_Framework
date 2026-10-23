package com.oracle.oic.utils;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;

/** Compares transaction rows without loading complete worksheets into memory. */
public final class InvoicedWorkbookComparator {

    private static final String REFERENCE_WORKBOOK = "invoiced-all-months.xlsx";
    private static final String BOOKED_REFERENCE_WORKBOOK = "Booked_All_Files.xlsx";
    private static final List<String> MONTHLY_WORKBOOKS = List.of(
            "jan.xlsx", "feb.xlsx", "mar-part1.xlsx", "mar-part2.xlsx", "apr.xlsx", "may.xlsx",
            "jun.xlsx", "jul.xlsx", "aug.xlsx", "sep.xlsx", "oct.xlsx", "nov.xlsx", "dec.xlsx");
    private static final XMLInputFactory XML_INPUT_FACTORY = XMLInputFactory.newFactory();

    private InvoicedWorkbookComparator() {
    }

    public static void run(Path root, Path output) throws IOException {
        run(root, REFERENCE_WORKBOOK, "INVOICED", output);
    }

    public static void runBooked(Path root, Path output) throws IOException {
        run(root, BOOKED_REFERENCE_WORKBOOK, "BOOKED", output);
    }

    public static void run(Path root, String referenceWorkbook, String transactionType, Path output)
            throws IOException {
        Path directory = root.resolve("test-results").resolve("downloads");
        Path referencePath = directory.resolve(referenceWorkbook);
        Map<String, String> reference = new HashMap<>();
        Map<String, String[]> referenceRowsByKey = new HashMap<>();
        Set<String> referenceDuplicates = new HashSet<>();
        Header referenceHeader = new Header();
        int[] referenceRows = {0};
        String[][] referenceHeaders = {null};

        readRows(referencePath, (row, rowNumber) -> {
            if (rowNumber == 1) {
                referenceHeader.read(row);
            referenceHeaders[0] = row;
                return;
            }
            if (!isTransactionType(row, referenceHeader, transactionType)) {
                return;
            }
            String key = value(row, referenceHeader.transactionNumberIndex);
            if (key.isEmpty()) {
                return;
            }
            referenceRows[0]++;
            if (reference.putIfAbsent(key, rowHash(row)) != null) {
                referenceDuplicates.add(key);
            } else {
                referenceRowsByKey.put(key, row);
            }
        });

        referenceHeader.requireHeaders(referenceWorkbook);
        List<String> keys = new ArrayList<>(reference.keySet());
        List<byte[]> statusesByMonth = new ArrayList<>();
        int[][] counts = new int[MONTHLY_WORKBOOKS.size()][3];
        List<String> diagnostics = new ArrayList<>();

        for (int monthIndex = 0; monthIndex < MONTHLY_WORKBOOKS.size(); monthIndex++) {
            String workbookName = MONTHLY_WORKBOOKS.get(monthIndex);
            Map<String, String> monthly = new HashMap<>();
            Set<String> duplicates = new HashSet<>();
            Header monthlyHeader = new Header();
            Path monthlyPath = directory.resolve(workbookName);
            if (Files.exists(monthlyPath)) {
                readRows(monthlyPath, (row, rowNumber) -> {
                    if (rowNumber == 1) {
                        monthlyHeader.read(row);
                        return;
                    }
                    if (!isTransactionType(row, monthlyHeader, transactionType)) {
                        return;
                    }
                    String key = value(row, monthlyHeader.transactionNumberIndex);
                    if (key.isEmpty()) {
                        return;
                    }
                    if (monthly.putIfAbsent(key, rowHash(row)) != null) {
                        duplicates.add(key);
                    }
                });
            } else {
                diagnostics.add(workbookName + ": file missing");
            }

            if (Files.exists(monthlyPath) && !monthlyHeader.hasRequiredHeaders()) {
                diagnostics.add(workbookName + ": missing required headers");
            }
            if (!duplicates.isEmpty()) {
                diagnostics.add(workbookName + ": duplicate " + transactionType.toLowerCase()
                        + " keys=" + duplicates.size());
            }

            byte[] statuses = new byte[keys.size()];
            for (int keyIndex = 0; keyIndex < keys.size(); keyIndex++) {
                String monthlyHash = monthly.get(keys.get(keyIndex));
                byte status = (byte) (monthlyHash == null
                    ? 2
                    : monthlyHash.equals(reference.get(keys.get(keyIndex))) ? 0 : 1);
                statuses[keyIndex] = status;
                counts[monthIndex][status & 0xff]++;
            }
            statusesByMonth.add(statuses);
            System.out.printf("%s MATCH=%d MISMATCH=%d MISSING=%d%n", workbookName,
                    counts[monthIndex][0], counts[monthIndex][1], counts[monthIndex][2]);
        }

        Files.createDirectories(output.toAbsolutePath().getParent());
        writeReport(output, keys, statusesByMonth, referenceHeaders[0], referenceRowsByKey);
        int missingAllMonths = 0;
        for (int keyIndex = 0; keyIndex < keys.size(); keyIndex++) {
            boolean missing = true;
            for (byte[] statuses : statusesByMonth) {
                missing &= statuses[keyIndex] == 2;
            }
            if (missing) {
                missingAllMonths++;
            }
        }
        System.out.printf("MISSING_ALL_MONTHS=%d%n", missingAllMonths);
        System.out.printf("OUTPUT=%s REFERENCE_%s=%d REFERENCE_DUPLICATES=%d%n",
            output, transactionType, referenceRows[0], referenceDuplicates.size());
    }

    public static void printHeaders(Path root) throws IOException {
        printHeaders(root, REFERENCE_WORKBOOK);
    }

    public static void printBookedHeaders(Path root) throws IOException {
        printHeaders(root, BOOKED_REFERENCE_WORKBOOK);
    }

    private static void printHeaders(Path root, String referenceWorkbook) throws IOException {
        Path directory = root.resolve("test-results").resolve("downloads");
        List<String> names = new ArrayList<>();
        names.add(referenceWorkbook);
        names.addAll(MONTHLY_WORKBOOKS);
        for (String name : names) {
            readRows(directory.resolve(name), (row, rowNumber) -> {
                if (rowNumber == 1) {
                    System.out.println(name + " HEADERS=" + String.join(" | ", row));
                }
            });
        }
    }

        private static void writeReport(Path output, List<String> keys, List<byte[]> statusesByMonth,
                String[] referenceHeaders, Map<String, String[]> referenceRowsByKey) throws IOException {
        try (Workbook workbook = new SXSSFWorkbook(100);
                OutputStream stream = Files.newOutputStream(output)) {
            Sheet missing = workbook.createSheet("Extra Transactions");
            Row missingHeader = missing.createRow(0);
                for (int column = 0; column < referenceHeaders.length; column++) {
                    writeCell(missingHeader, column, value(referenceHeaders, column));
                }
            int outputRow = 1;
            for (int keyIndex = 0; keyIndex < keys.size(); keyIndex++) {
                boolean missingEverywhere = true;
                for (byte[] statuses : statusesByMonth) {
                    missingEverywhere &= statuses[keyIndex] == 2;
                }
                if (!missingEverywhere) {
                    continue;
                }
                Row row = missing.createRow(outputRow++);
                String[] referenceRow = referenceRowsByKey.get(keys.get(keyIndex));
                for (int column = 0; column < referenceHeaders.length; column++) {
                    writeCell(row, column, value(referenceRow, column));
                }
            }
            workbook.write(stream);
            ((SXSSFWorkbook) workbook).dispose();
        }
    }

    private static void writeCell(Row row, int column, String value) {
        Cell cell = row.createCell(column);
        cell.setCellValue(value);
    }

    private static void readRows(Path path, RowConsumer consumer) throws IOException {
        try (ZipFile zip = new ZipFile(path.toFile())) {
            List<String> sharedStrings = readSharedStrings(zip);
            ZipEntry sheet = zip.stream()
                    .filter(entry -> entry.getName().startsWith("xl/worksheets/") && entry.getName().endsWith(".xml"))
                    .findFirst()
                    .orElseThrow(() -> new IOException("No worksheet XML found in " + path));
            try (InputStream input = zip.getInputStream(sheet)) {
                XMLStreamReader reader = XML_INPUT_FACTORY.createXMLStreamReader(input);
                int rowNumber = 0;
                while (reader.hasNext()) {
                    if (reader.next() == XMLStreamConstants.START_ELEMENT && "row".equals(reader.getLocalName())) {
                        rowNumber++;
                        consumer.accept(readRow(reader, sharedStrings), rowNumber);
                    }
                }
                reader.close();
            } catch (XMLStreamException exception) {
                throw new IOException("Could not parse worksheet XML in " + path, exception);
            }
        }
    }

    private static List<String> readSharedStrings(ZipFile zip) throws IOException {
        ZipEntry entry = zip.getEntry("xl/sharedStrings.xml");
        List<String> values = new ArrayList<>();
        if (entry == null) {
            return values;
        }
        try (InputStream input = zip.getInputStream(entry)) {
            XMLStreamReader reader = XML_INPUT_FACTORY.createXMLStreamReader(input);
            StringBuilder text = new StringBuilder();
            boolean inItem = false;
            while (reader.hasNext()) {
                int event = reader.next();
                if (event == XMLStreamConstants.START_ELEMENT && "si".equals(reader.getLocalName())) {
                    inItem = true;
                    text.setLength(0);
                } else if (inItem && event == XMLStreamConstants.CHARACTERS) {
                    text.append(reader.getText());
                } else if (event == XMLStreamConstants.END_ELEMENT && "si".equals(reader.getLocalName())) {
                    values.add(text.toString());
                    inItem = false;
                }
            }
            reader.close();
            return values;
        } catch (XMLStreamException exception) {
            throw new IOException("Could not parse shared strings", exception);
        }
    }

    private static String[] readRow(XMLStreamReader reader, List<String> sharedStrings) throws XMLStreamException {
        Map<Integer, String> cells = new TreeMap<>();
        while (reader.hasNext()) {
            int event = reader.next();
            if (event == XMLStreamConstants.START_ELEMENT && "c".equals(reader.getLocalName())) {
                String reference = reader.getAttributeValue(null, "r");
                String type = reader.getAttributeValue(null, "t");
                String rawValue = readCell(reader);
                if ("s".equals(type)) {
                    try {
                        int sharedIndex = Integer.parseInt(rawValue);
                        if (sharedIndex >= 0 && sharedIndex < sharedStrings.size()) {
                            rawValue = sharedStrings.get(sharedIndex);
                        }
                    } catch (NumberFormatException ignored) {
                        // Keep malformed shared-string references as their raw value.
                    }
                }
                cells.put(columnIndex(reference), rawValue.trim());
            } else if (event == XMLStreamConstants.END_ELEMENT && "row".equals(reader.getLocalName())) {
                break;
            }
        }
        if (cells.isEmpty()) {
            return new String[0];
        }
        String[] row = new String[cells.keySet().stream().max(Integer::compareTo).orElse(0) + 1];
        cells.forEach((index, value) -> row[index] = value);
        return row;
    }

    private static String readCell(XMLStreamReader reader) throws XMLStreamException {
        StringBuilder value = new StringBuilder();
        while (reader.hasNext()) {
            int event = reader.next();
            if (event == XMLStreamConstants.START_ELEMENT
                    && ("v".equals(reader.getLocalName()) || "t".equals(reader.getLocalName()))) {
                value.append(reader.getElementText());
            } else if (event == XMLStreamConstants.END_ELEMENT && "c".equals(reader.getLocalName())) {
                break;
            }
        }
        return value.toString();
    }

    private static int columnIndex(String reference) {
        int value = 0;
        for (int index = 0; index < reference.length(); index++) {
            char character = reference.charAt(index);
            if (!Character.isLetter(character)) {
                break;
            }
            value = value * 26 + Character.toUpperCase(character) - 'A' + 1;
        }
        return value - 1;
    }

    private static boolean isTransactionType(String[] row, Header header, String transactionType) {
        return header.hasRequiredHeaders()
                && value(row, header.transactionTypeIndex).equalsIgnoreCase(transactionType);
    }

    private static String value(String[] row, int index) {
        return index >= 0 && index < row.length && row[index] != null ? row[index].trim() : "";
    }

    private static String rowHash(String[] row) {
        int hash = 0x811c9dc5;
        for (int index = 0; index < row.length; index++) {
            for (byte character : value(row, index).getBytes(StandardCharsets.UTF_8)) {
                hash ^= character & 0xff;
                hash *= 0x01000193;
            }
            hash ^= 31;
            hash *= 0x01000193;
        }
        return String.format("%08X", hash);
    }

    @FunctionalInterface
    private interface RowConsumer {
        void accept(String[] row, int rowNumber) throws IOException;
    }

    private static final class Header {
        private int transactionTypeIndex = -1;
        private int transactionNumberIndex = -1;

        private void read(String[] row) {
            for (int index = 0; index < row.length; index++) {
                String header = value(row, index);
                if (header.equalsIgnoreCase("Transaction Type")) {
                    transactionTypeIndex = index;
                } else if (header.equalsIgnoreCase("Transaction Number")) {
                    transactionNumberIndex = index;
                }
            }
        }

        private boolean hasRequiredHeaders() {
            return transactionTypeIndex >= 0 && transactionNumberIndex >= 0;
        }

        private void requireHeaders(String workbookName) {
            if (!hasRequiredHeaders()) {
                throw new IllegalArgumentException("Required headers were not found in " + workbookName);
            }
        }
    }
}