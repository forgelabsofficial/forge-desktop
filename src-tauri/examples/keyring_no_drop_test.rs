use keyring::Entry;

fn main() {
    println!("Testing keyring WITHOUT dropping entry...");
    
    let service = "forge-desktop";
    let account = "test_profile_12345";
    let password = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
    
    // Clean up
    if let Ok(entry) = Entry::new(service, account) {
        let _ = entry.delete_credential();
        println!("Cleaned up any existing test credentials");
    }
    
    std::thread::sleep(std::time::Duration::from_millis(200));
    
    // Create ONE entry and keep it
    println!("\n1. Creating entry...");
    let entry = match Entry::new(service, account) {
        Ok(e) => {
            println!("   ✓ Created entry");
            e
        },
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    };
    
    println!("2. Storing password...");
    match entry.set_password(password) {
        Ok(_) => println!("   ✓ Stored"),
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    }
    
    // Don't drop - reuse same entry
    std::thread::sleep(std::time::Duration::from_millis(200));
    
    println!("\n3. Retrieving password (same entry)...");
    match entry.get_password() {
        Ok(retrieved) => {
            if retrieved == password {
                println!("   ✓ Retrieved and matches!");
            } else {
                eprintln!("   ✗ Doesn't match: got '{}', expected '{}'", retrieved, password);
            }
        },
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    }
    
    // Clean up
    println!("\n4. Cleaning up...");
    match entry.delete_credential() {
        Ok(_) => println!("   ✓ Deleted"),
        Err(e) => eprintln!("   ✗ Failed: {}", e),
    }
    
    println!("\nTest completed!");
}
