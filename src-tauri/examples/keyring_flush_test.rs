use keyring::Entry;

fn main() {
    println!("Testing if keyring persists after longer wait...");
    
    let service = "forge-desktop";
    let account = "test_profile_12345";
    let password = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
    
    // Clean up
    if let Ok(entry) = Entry::new(service, account) {
        let _ = entry.delete_credential();
        println!("Cleaned up any existing test credentials");
    }
    
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    // Store with explicit scope
    {
        println!("\n1. Creating entry and storing...");
        let entry = Entry::new(service, account).unwrap();
        entry.set_password(password).unwrap();
        println!("   ✓ Stored (entry about to go out of scope)");
    } // Entry dropped here
    
    println!("2. Entry dropped, waiting 2 seconds for Windows to persist...");
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // Try to retrieve with NEW entry
    println!("\n3. Creating NEW entry to retrieve...");
    let entry2 = Entry::new(service, account).unwrap();
    
    match entry2.get_password() {
        Ok(retrieved) => {
            if retrieved == password {
                println!("   ✓ Retrieved and matches!");
            } else {
                eprintln!("   ✗ Doesn't match");
            }
        },
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            println!("\n   Trying to check Windows Credential Manager directly...");
            println!("   Run: cmdkey /list | findstr forge-desktop");
        }
    }
    
    // Clean up
    let _ = entry2.delete_credential();
    
    println!("\nTest completed!");
}
